#!/usr/bin/env node
import { App, Stack } from 'aws-cdk-lib';
import { CfnEventSourceMapping } from 'aws-cdk-lib/aws-lambda';
const app = new App();
const stack = new Stack(app, 'LiassOhadaDevBoundFiscalStream', { env: { account: '570197775998', region: 'eu-west-3' } });
new CfnEventSourceMapping(stack, 'BoundIntentsV1', {
 functionName: 'liass-ohada-dev-fiscal-compliance-real-test',
 eventSourceArn: 'arn:aws:dynamodb:eu-west-3:570197775998:table/liass-ohada-dev-restaurants-table/stream/2026-11-18T13:03:35.908',
 startingPosition: 'LATEST', enabled: app.node.tryGetContext('boundFiscalStreamEnabled') === true,
 batchSize: 10, functionResponseTypes: ['ReportBatchItemFailures'],
 filterCriteria: { filters: [{ pattern: JSON.stringify({ eventName: ['INSERT'], dynamodb: { Keys: { SK: { S: ['FISCAL_INTENT#V1'] } } } }) }] },
});
