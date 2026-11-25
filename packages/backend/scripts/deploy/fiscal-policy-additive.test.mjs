import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('standalone policy API imports dependencies and contains only additive authenticated endpoints', () => {
 const template = JSON.parse(readFileSync(new URL('../../cdk.out/fiscal-policy-additive/LiassOhadaDevFiscalPolicyApi.template.json', import.meta.url)));
 const resources = Object.values(template.Resources);
 const counts = type => resources.filter(r => r.Type === type);
 for (const type of ['AWS::Lambda::Function','AWS::ApiGatewayV2::Route','AWS::ApiGatewayV2::Integration','AWS::Lambda::Permission']) assert.equal(counts(type).length,2);
 assert.equal(resources.filter(r => !['AWS::Lambda::Function','AWS::ApiGatewayV2::Route','AWS::ApiGatewayV2::Integration','AWS::Lambda::Permission','AWS::CDK::Metadata','AWS::Logs::LogGroup'].includes(r.Type)).length,0);
 for (const r of counts('AWS::ApiGatewayV2::Route')) { assert.equal(r.Properties.ApiId,'mk5jf2sco3'); assert.equal(r.Properties.AuthorizationType,'JWT');assert.equal(r.Properties.AuthorizerId,'m8yqfd'); }
 for (const r of counts('AWS::Lambda::Permission')) assert.match(r.Properties.SourceArn,/\/\*\/(GET|PUT)\/me\/organization\/fiscality\/issuance-policy$/);
});
