import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const normalize = (value) => {
  if (Array.isArray(value)) return `[${value.map(normalize).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${normalize(value[key])}`).join(",")}}`;
};

function resolveRefs(value, parameters, path = "$", resolving = new Set()) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, parameters));
  if (!value || typeof value !== "object") return value;
  if (Object.keys(value).length === 1 && typeof value.Ref === "string") {
    if (!(value.Ref in parameters)) throw new Error(`Unresolved Ref ${value.Ref} at ${path}`);
    if (resolving.has(value.Ref)) throw new Error(`Cyclic Ref ${value.Ref} at ${path}`);
    return resolveRefs(parameters[value.Ref], parameters, `${path}.Ref(${value.Ref})`, new Set([...resolving, value.Ref]));
  }
  if (Object.keys(value).length === 1 && Array.isArray(value["Fn::Join"])) {
    const [separator, parts] = value["Fn::Join"];
    if (typeof separator !== "string" || !Array.isArray(parts)) throw new Error(`Invalid Join at ${path}`);
    return parts.map((part, index) => resolveRefs(part, parameters, `${path}.Join[${index}]`, resolving)).join(separator);
  }
  if (Object.keys(value).length === 1 && Array.isArray(value["Fn::GetAtt"])) {
    const [resource, attribute] = value["Fn::GetAtt"];
    const key = `GetAtt:${resource}.${attribute}`;
    if (!(key in parameters)) throw new Error(`Unresolved ${key} at ${path}`);
    return resolveRefs(parameters[key], parameters, `${path}.${key}`, resolving);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, parameters, `${path}.${key}`, resolving)]));
}

/**
 * Classifies child-stack Modify records without treating CloudFormation's
 * Dynamic evaluation marker as an approved change. A dynamic record is only
 * a no-op when the fully resolved live and candidate resource properties are
 * byte-for-byte equal; anything else fails closed.
 */
export function classifyResolvedChanges({ liveTemplate, candidateTemplate, childChangeSet, parameters = {} }) {
  const live = liveTemplate.Resources ?? {};
  const candidate = candidateTemplate.Resources ?? {};
  const additions = [];
  const codeUpdates = [];
  const noopDynamic = [];
  const unexpected = [];
  for (const entry of childChangeSet.Changes ?? []) {
    const change = entry.ResourceChange;
    const before = live[change.LogicalResourceId];
    const after = candidate[change.LogicalResourceId];
    if (change.Action === "Add" && !before && after) { additions.push(change.LogicalResourceId); continue; }
    if (change.Action !== "Modify" || !before || !after) { unexpected.push(change.LogicalResourceId); continue; }
    const beforeProperties = resolveRefs(before.Properties ?? {}, parameters);
    const afterProperties = resolveRefs(after.Properties ?? {}, parameters);
    const beforeCode = beforeProperties.Code;
    const afterCode = afterProperties.Code;
    const withoutCode = (properties) => { const copy = structuredClone(properties); delete copy.Code; return copy; };
    if (normalize(withoutCode(beforeProperties)) !== normalize(withoutCode(afterProperties))) {
      unexpected.push(change.LogicalResourceId);
    } else if (normalize(beforeCode) !== normalize(afterCode)) {
      codeUpdates.push(change.LogicalResourceId);
    } else {
      noopDynamic.push(change.LogicalResourceId);
    }
  }
  if (unexpected.length) throw new Error(`Unexpected semantic changes: ${unexpected.join(", ")}`);
  return { additions, codeUpdates, noopDynamic, unexpected };
}

/** Full release gate: parent scope plus each nested stack scope. */
export function reviewReleaseScope({ root, parentLive, parentCandidate, stacks }) {
  assert.equal(root.Status, "CREATE_COMPLETE");
  assert.equal(root.ExecutionStatus, "AVAILABLE");
  assert.equal(root.IncludeNestedStacks, true);
  assert.equal(root.NextToken, undefined, "Incomplete root pagination");
  const allowedParent = new Set(stacks.map((stack) => stack.logicalId));
  for (const entry of root.Changes ?? []) {
    const change = entry.ResourceChange;
    if (change.Action !== "Modify" || !allowedParent.has(change.LogicalResourceId) || change.Replacement === "True")
      throw new Error(`Unexpected parent change: ${change.LogicalResourceId}:${change.Action}:${change.Replacement}`);
    if (!change.ChangeSetId) throw new Error(`Missing child change set for ${change.LogicalResourceId}`);
  }
  if (root.Changes.length !== allowedParent.size) throw new Error("Parent change set is not exactly the approved nested-stack set");
  const parentLiveResources = parentLive.Resources ?? {};
  const parentCandidateResources = parentCandidate.Resources ?? {};
  for (const stack of stacks) {
    const parentBefore = parentLiveResources[stack.logicalId];
    const parentAfter = parentCandidateResources[stack.logicalId];
    if (!parentBefore || !parentAfter) throw new Error(`Missing parent nested stack ${stack.logicalId}`);
    const parentParams = stack.parentParameters ?? {};
    resolveRefs(parentAfter.Properties ?? {}, parentParams);
    const result = classifyResolvedChanges({
      liveTemplate: stack.liveTemplate,
      candidateTemplate: stack.candidateTemplate,
      childChangeSet: stack.childChangeSet,
      parameters: stack.parameters,
    });
    for (const id of result.additions) if (!stack.allowedAdditions.some((pattern) => pattern.test(id))) throw new Error(`Unapproved ${stack.name} addition: ${id}`);
    for (const id of result.codeUpdates) if (!stack.allowedCodeUpdates.some((pattern) => pattern.test(id))) throw new Error(`Unapproved ${stack.name} code update: ${id}`);
    for (const id of result.noopDynamic) if (!stack.childChangeSet.Changes.some((entry) => entry.ResourceChange.LogicalResourceId === id)) throw new Error(`Untracked dynamic change: ${id}`);
  }
  return { status: "PASS", parentChanges: root.Changes.length };
}

export function review(root, child, expected) {
  assert.equal(root.Status, "CREATE_COMPLETE");
  assert.equal(root.ExecutionStatus, "AVAILABLE");
  assert.equal(root.IncludeNestedStacks, true);
  assert.equal(root.NextToken, undefined, "Incomplete root pagination");
  assert.equal(root.Changes.length, 1);
  const parent = root.Changes[0].ResourceChange;
  assert.equal(parent.LogicalResourceId, "IdentityApiNestedStackIdentityApiNestedStackResource9538678F");
  assert.equal(parent.Action, "Modify");
  assert.equal(parent.Replacement, "False");
  assert.ok(parent.ChangeSetId, "Missing Identity child change set");
  assert.equal(child.ChangeSetId, parent.ChangeSetId);
  assert.equal(child.Status, "CREATE_COMPLETE");
  assert.equal(child.ExecutionStatus, "AVAILABLE");
  assert.equal(child.NextToken, undefined, "Incomplete child pagination");
  assert.equal(child.Changes.length, 34);
  const seen = new Set();
  for (const change of child.Changes) {
    const resource = change.ResourceChange;
    assert.equal(resource.Action, "Add");
    assert.equal(resource.ResourceType, expected[resource.LogicalResourceId]);
    assert.ok(expected[resource.LogicalResourceId]);
    assert.ok(!seen.has(resource.LogicalResourceId));
    seen.add(resource.LogicalResourceId);
    assert.ok(!resource.Details?.some(detail => detail.Evaluation === "Dynamic"), "Dynamic change requires investigation");
  }
  assert.equal(seen.size, 34);
  return { status: "PASS", parentChanges: 1, identityAdditions: 34 };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const values = process.argv.slice(2).map(file => JSON.parse(readFileSync(file, "utf8")));
  console.log(JSON.stringify(review(...values)));
}
