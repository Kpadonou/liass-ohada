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
    if (!(value.Ref in parameters) && parameters[`StableResource:${value.Ref}`]) return `Ref:${value.Ref}`;
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
    if (!(key in parameters) && parameters[`StableResource:${resource}`]) return key;
    if (!(key in parameters)) throw new Error(`Unresolved ${key} at ${path}`);
    return resolveRefs(parameters[key], parameters, `${path}.${key}`, resolving);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, parameters, `${path}.${key}`, resolving)]));
}

export function reviewParentNoop(change, liveResource, candidateResource, resolutions) {
  if (!liveResource || !candidateResource || normalize(liveResource) !== normalize(candidateResource))
    throw new Error(`Parent template resource changed: ${change.LogicalResourceId}`);
  const allowed = change.ResourceType === "AWS::ApiGatewayV2::Integration"
    ? { replacement: "False", targets: new Set(["Properties:IntegrationUri"]) }
    : change.ResourceType === "AWS::Lambda::Permission"
      ? { replacement: "Conditional", targets: new Set(["Properties:FunctionName"]) }
      : undefined;
  if (!allowed || change.Action !== "Modify" || change.Replacement !== allowed.replacement)
    throw new Error(`Unapproved parent resource change: ${change.LogicalResourceId}`);
  const details = change.Details ?? [];
  if (!details.length || details.some((detail) => detail.Evaluation !== "Dynamic" ||
      !allowed.targets.has(`${detail.Target?.Attribute}:${detail.Target?.Name}`)))
    throw new Error(`Unexpected parent change detail: ${change.LogicalResourceId}`);
  const before = resolveRefs(liveResource.Properties ?? {}, resolutions, `$parent.${change.LogicalResourceId}.live`);
  const after = resolveRefs(candidateResource.Properties ?? {}, resolutions, `$parent.${change.LogicalResourceId}.candidate`);
  if (normalize(before) !== normalize(after)) throw new Error(`Resolved parent properties differ: ${change.LogicalResourceId}`);
  if (change.ResourceType === "AWS::Lambda::Permission" &&
      (typeof before.FunctionName !== "string" || before.FunctionName !== after.FunctionName))
    throw new Error(`Permission replacement risk unresolved: ${change.LogicalResourceId}`);
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
  const resolutions = { ...parameters };
  for (const [id, before] of Object.entries(live)) {
    const after = candidate[id];
    if (!after || before.Type !== after.Type) continue;
    const left = structuredClone(before), right = structuredClone(after);
    if (before.Type === "AWS::Lambda::Function") { delete left.Properties?.Code; delete right.Properties?.Code; }
    if (normalize(left) === normalize(right)) resolutions[`StableResource:${id}`] = true;
  }
  for (const entry of childChangeSet.Changes ?? []) {
    const change = entry.ResourceChange;
    const before = live[change.LogicalResourceId];
    const after = candidate[change.LogicalResourceId];
    if (change.Action === "Add" && !before && after) { additions.push(change.LogicalResourceId); continue; }
    if (change.Action !== "Modify" || !before || !after) { unexpected.push(change.LogicalResourceId); continue; }
    if (change.Replacement === "True") throw new Error(`Replacement risk is not contained: ${change.LogicalResourceId}`);
    const beforeProperties = before.Properties ?? {};
    const afterProperties = after.Properties ?? {};
    const beforeCode = beforeProperties.Code;
    const afterCode = afterProperties.Code;
    const withoutCode = (properties) => { const copy = structuredClone(properties); delete copy.Code; return copy; };
    if (normalize(withoutCode(beforeProperties)) !== normalize(withoutCode(afterProperties))) {
      unexpected.push(change.LogicalResourceId);
    } else if (normalize(beforeCode) !== normalize(afterCode)) {
      codeUpdates.push(change.LogicalResourceId);
    } else {
      if (!(change.Details?.length)) throw new Error(`Missing dynamic details: ${change.LogicalResourceId}`);
      for (const detail of change.Details) {
        if (detail.Evaluation !== "Dynamic" || detail.Target?.Attribute !== "Properties" || !detail.Target.Name)
          throw new Error(`Unreviewable dynamic detail: ${change.LogicalResourceId}`);
        const name = detail.Target.Name;
        const resolvedBefore = resolveRefs(beforeProperties[name], resolutions, `$.${change.LogicalResourceId}.${name}.live`);
        const resolvedAfter = resolveRefs(afterProperties[name], resolutions, `$.${change.LogicalResourceId}.${name}.candidate`);
        if (normalize(resolvedBefore) !== normalize(resolvedAfter)) throw new Error(`Resolved child property differs: ${change.LogicalResourceId}.${name}`);
      }
      noopDynamic.push(change.LogicalResourceId);
    }
  }
  if (unexpected.length) throw new Error(`Unexpected semantic changes: ${unexpected.join(", ")}`);
  return { additions, codeUpdates, noopDynamic, unexpected };
}

/** Full release gate: parent scope plus each nested stack scope. */
export function reviewReleaseScope({ root, parentLive, parentCandidate, parentResolutions = {}, stacks }) {
  assert.equal(root.Status, "CREATE_COMPLETE");
  assert.equal(root.ExecutionStatus, "AVAILABLE");
  assert.equal(root.IncludeNestedStacks, true);
  assert.equal(root.NextToken, undefined, "Incomplete root pagination");
  const allowedParent = new Set(stacks.map((stack) => stack.logicalId));
  const nestedChanges = [];
  const parentNoops = [];
  for (const entry of root.Changes ?? []) {
    const change = entry.ResourceChange;
    if (allowedParent.has(change.LogicalResourceId)) {
      if (change.Action !== "Modify" || change.Replacement !== "False" || !change.ChangeSetId)
        throw new Error(`Unexpected nested-stack change: ${change.LogicalResourceId}:${change.Action}:${change.Replacement}`);
      nestedChanges.push(change);
    } else {
      if (change.ChangeSetId) throw new Error(`Unexpected child change set: ${change.LogicalResourceId}`);
      reviewParentNoop(change, parentLive.Resources?.[change.LogicalResourceId], parentCandidate.Resources?.[change.LogicalResourceId], parentResolutions);
      parentNoops.push(change.LogicalResourceId);
    }
  }
  if (nestedChanges.length !== allowedParent.size) throw new Error("Parent change set is not exactly the approved nested-stack set");
  const parentLiveResources = parentLive.Resources ?? {};
  const parentCandidateResources = parentCandidate.Resources ?? {};
  for (const stack of stacks) {
    const parentBefore = parentLiveResources[stack.logicalId];
    const parentAfter = parentCandidateResources[stack.logicalId];
    if (!parentBefore || !parentAfter) throw new Error(`Missing parent nested stack ${stack.logicalId}`);
    const beforeStatic = structuredClone(parentBefore), afterStatic = structuredClone(parentAfter);
    delete beforeStatic.Properties?.TemplateURL; delete afterStatic.Properties?.TemplateURL;
    const beforeParameters = beforeStatic.Properties?.Parameters ?? {};
    const afterParameters = afterStatic.Properties?.Parameters ?? {};
    delete beforeStatic.Properties?.Parameters; delete afterStatic.Properties?.Parameters;
    if (normalize(beforeStatic) !== normalize(afterStatic))
      throw new Error(`Nested-stack parent properties changed: ${stack.logicalId}`);
    if (normalize(Object.keys(beforeParameters).sort()) !== normalize(Object.keys(afterParameters).sort()))
      throw new Error(`Nested-stack parameter contract changed: ${stack.logicalId}`);
    for (const [name, currentValue] of Object.entries(stack.parameters ?? {})) {
      if (!(name in beforeParameters) || afterParameters[name] !== currentValue)
        throw new Error(`Nested-stack parameter is not frozen to the live value: ${stack.logicalId}.${name}`);
    }
    if (Object.keys(afterParameters).length !== Object.keys(stack.parameters ?? {}).length)
      throw new Error(`Nested-stack parameter evidence incomplete: ${stack.logicalId}`);
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
  return { status: "PASS", nestedStackChanges: nestedChanges.length, resolvedParentNoops: parentNoops.length };
}

export function reviewReleaseManifest(manifest, readJson = (file) => JSON.parse(readFileSync(file, "utf8"))) {
  return reviewReleaseScope({
    root: readJson(manifest.rootChangeSet),
    parentLive: readJson(manifest.parentLive),
    parentCandidate: readJson(manifest.parentCandidate),
    parentResolutions: readJson(manifest.parentResolutions),
    stacks: manifest.stacks.map((stack) => ({
      ...stack,
      liveTemplate: readJson(stack.liveTemplate),
      candidateTemplate: readJson(stack.candidateTemplate),
      childChangeSet: readJson(stack.childChangeSet),
      parameters: readJson(stack.parameters),
      allowedAdditions: stack.allowedAdditions.map((pattern) => new RegExp(pattern)),
      allowedCodeUpdates: stack.allowedCodeUpdates.map((pattern) => new RegExp(pattern)),
    })),
  });
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (files.length === 1) console.log(JSON.stringify(reviewReleaseManifest(JSON.parse(readFileSync(files[0], "utf8")))));
  else console.log(JSON.stringify(review(...files.map(file => JSON.parse(readFileSync(file, "utf8"))))));
}
