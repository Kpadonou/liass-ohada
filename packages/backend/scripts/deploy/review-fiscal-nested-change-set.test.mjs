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
  const child = {Changes:[{ResourceChange:{LogicalResourceId:"Keep",Action:"Modify",Replacement:"False",Details:[{Evaluation:"Dynamic",Target:{Attribute:"Properties",Name:"ApiId"}}]}}]};
  assert.throws(() => reviewReleaseScope({root,parentLive:{Resources:{Identity:{}}},parentCandidate:{Resources:{Identity:{}}},stacks:[{
    name:"Identity",logicalId:"Identity",liveTemplate:live,candidateTemplate:candidate,childChangeSet:child,
    parameters:{},parentParameters:{},allowedAdditions:[],allowedCodeUpdates:[]
  }]}), /Unresolved Ref/);
});

test("full scope accepts the three approved nested stacks", () => {
  const ids = ["Identity", "Restaurants", "Fiscal"];
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:ids.map((id) => ({ResourceChange:{LogicalResourceId:id,Action:"Modify",Replacement:"False",ChangeSetId:id}}))};
  const stacks = ids.map((name) => ({
    name, logicalId:name, liveTemplate:{Resources:{}}, candidateTemplate:{Resources:{}},
    childChangeSet:{Changes:[]}, parameters:{}, parentParameters:{}, allowedAdditions:[], allowedCodeUpdates:[]
  }));
  assert.equal(reviewReleaseScope({root,parentLive:{Resources:Object.fromEntries(ids.map((id) => [id,{}]))},parentCandidate:{Resources:Object.fromEntries(ids.map((id) => [id,{}]))},stacks}).status,"PASS");
});

test("full scope accepts only proven parent dynamic no-ops", () => {
  const nested = ["Identity", "Restaurants", "Fiscal"];
  const integration = "ExistingIntegration";
  const permission = "ExistingPermission";
  const resources = {
    ...Object.fromEntries(nested.map((id) => [id,{}])),
    [integration]: {Type:"AWS::ApiGatewayV2::Integration",Properties:{ApiId:{Ref:"ApiId"},IntegrationUri:{"Fn::GetAtt":["Identity","Outputs.HandlerArn"]}}},
    [permission]: {Type:"AWS::Lambda::Permission",Properties:{Action:"lambda:InvokeFunction",FunctionName:{"Fn::GetAtt":["Identity","Outputs.HandlerArn"]}}},
  };
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:[
    ...nested.map((id) => ({ResourceChange:{LogicalResourceId:id,Action:"Modify",Replacement:"False",ChangeSetId:id}})),
    {ResourceChange:{LogicalResourceId:integration,ResourceType:"AWS::ApiGatewayV2::Integration",Action:"Modify",Replacement:"False",Details:[{Evaluation:"Dynamic",Target:{Attribute:"Properties",Name:"IntegrationUri"}}]}},
    {ResourceChange:{LogicalResourceId:permission,ResourceType:"AWS::Lambda::Permission",Action:"Modify",Replacement:"Conditional",Details:[{Evaluation:"Dynamic",Target:{Attribute:"Properties",Name:"FunctionName"}}]}},
  ]};
  const stacks = nested.map((name) => ({name,logicalId:name,liveTemplate:{Resources:{}},candidateTemplate:{Resources:{}},childChangeSet:{Changes:[]},parameters:{},parentParameters:{},allowedAdditions:[],allowedCodeUpdates:[]}));
  const result = reviewReleaseScope({root,parentLive:{Resources:resources},parentCandidate:{Resources:structuredClone(resources)},parentResolutions:{ApiId:"api-1","GetAtt:Identity.Outputs.HandlerArn":"arn:aws:lambda:eu-west-3:1:function:handler"},stacks});
  assert.deepEqual(result,{status:"PASS",nestedStackChanges:3,resolvedParentNoops:2});
  assert.throws(() => reviewReleaseScope({root,parentLive:{Resources:resources},parentCandidate:{Resources:structuredClone(resources)},parentResolutions:{ApiId:"api-1"},stacks}), /Unresolved GetAtt/);
});

test("full scope rejects child replacements even when template properties match", () => {
  const root = {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",IncludeNestedStacks:true,Changes:[{ResourceChange:{LogicalResourceId:"Restaurants",Action:"Modify",Replacement:"False",ChangeSetId:"r"}}]};
  const resource = {Type:"AWS::ApiGatewayV2::Route",Properties:{ApiId:{Ref:"ApiId"}}};
  const stack = {name:"restaurants",logicalId:"Restaurants",liveTemplate:{Resources:{Route:resource}},candidateTemplate:{Resources:{Route:structuredClone(resource)}},childChangeSet:{Changes:[{ResourceChange:{LogicalResourceId:"Route",Action:"Modify",Replacement:"True",Details:[{Evaluation:"Dynamic",Target:{Attribute:"Properties",Name:"ApiId"}}]}}]},parameters:{ApiId:"api-1"},allowedAdditions:[],allowedCodeUpdates:[]};
  assert.throws(() => reviewReleaseScope({root,parentLive:{Resources:{Restaurants:{}}},parentCandidate:{Resources:{Restaurants:{}}},stacks:[stack]}), /Replacement risk/);
});
