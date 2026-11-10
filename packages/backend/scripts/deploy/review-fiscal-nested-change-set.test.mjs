import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { review, reviewReleaseScope } from "./review-fiscal-nested-change-set.mjs";

test("missing, incomplete and unexpected child changes fail closed", () => {
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:[{ResourceChange:{LogicalResourceId:"IdentityApiNestedStackIdentityApiNestedStackResource9538678F",Action:"Modify",Replacement:"False",ChangeSetId:"child"}}]};
  const expected = Object.fromEntries(Array.from({length:34},(_,i)=>[`R${i}`,"AWS::Lambda::Function"]));
  const child = {ChangeSetId:"child",Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",Changes:Object.keys(expected).map(id=>({ResourceChange:{LogicalResourceId:id,ResourceType:expected[id],Action:"Add"}}))};
  assert.equal(review(root,child,expected).status,"PASS");
  for (const invalid of [{...child,Changes:[]},{...child,NextToken:"more"},{...child,ChangeSetId:"wrong"}]) assert.throws(()=>review(root,invalid,expected));
  child.Changes[0].ResourceChange.Action="Modify";
  assert.throws(()=>review(root,child,expected));
});
test("amended procedure includes nested changes and never executes them",()=>{
  const procedure=readFileSync(new URL("../../../../.liass-releases/liass-fiscal-onboarding-v1-b4/e686367/amendments/b5-a-v1/prepare-b5-change-set.sh",import.meta.url),"utf8");
  assert.ok(procedure.includes("--include-nested-stacks"));
  assert.ok(!procedure.includes("execute-change-set"));
});

test("full scope rejects an unexpected parent stack", () => {
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:[
    {ResourceChange:{LogicalResourceId:"Identity",Action:"Modify",Replacement:"False",ChangeSetId:"i"}},
    {ResourceChange:{LogicalResourceId:"Unapproved",Action:"Modify",Replacement:"False",ChangeSetId:"u"}},
  ]};
  assert.throws(() => reviewReleaseScope({root,parentLive:{Resources:{}},parentCandidate:{Resources:{}},stacks:[{logicalId:"Identity"}]}));
});

test("full scope rejects unresolved dynamic references", () => {
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:[
    {ResourceChange:{LogicalResourceId:"Identity",Action:"Modify",Replacement:"False",ChangeSetId:"i"}},
  ]};
  const live = {Resources:{Keep:{Type:"AWS::ApiGatewayV2::Route",Properties:{ApiId:{Ref:"ApiId"}}}}};
  const candidate = structuredClone(live);
  const child = {Changes:[{ResourceChange:{LogicalResourceId:"Keep",Action:"Modify",Replacement:"False"}}]};
  assert.throws(() => reviewReleaseScope({root,parentLive:{Resources:{Identity:{}}},parentCandidate:{Resources:{Identity:{}}},stacks:[{
    name:"Identity",logicalId:"Identity",liveTemplate:live,candidateTemplate:candidate,childChangeSet:child,
    parameters:{},parentParameters:{},allowedAdditions:[],allowedCodeUpdates:[]
  }]}), /Unresolved Ref/);
});
