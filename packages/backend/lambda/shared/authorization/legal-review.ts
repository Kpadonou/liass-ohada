import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { config, dynamoClient } from '../dynamo-client';
import { KeyFactory as K } from '../key-builder';
import { AppError } from '../app-error';
import { PlatformPrincipal, PlatformPrincipalSchema, PlatformGrantSchema, platformPrincipalDigest, PLATFORM_LEGAL_IDENTITY_REVIEW } from './platform-admin';
export async function requireLegalReviewer(principal: PlatformPrincipal | string) {
  const p = PlatformPrincipalSchema.safeParse(principal);
  if (!p.success) throw new AppError(403, 'AUTHORITY_REVIEW_NOT_AUTHORIZED');
  const key = {PK: K.platformAdminPK(p.data.stage, platformPrincipalDigest(p.data)), SK: K.platformLegalReviewGrantSK()};
  const out = await dynamoClient.send(new GetItemCommand({TableName:config.PLATFORM_TABLE_NAME,Key:marshall(key),ConsistentRead:true}));
  const row = out.Item ? unmarshall(out.Item) : undefined;
  const grant = PlatformGrantSchema.safeParse(row?.data);
  if (!row || row.PK !== key.PK || row.SK !== key.SK || row.entityType !== 'PLATFORM_ADMIN_GRANT' || !grant.success ||
    grant.data.permission !== PLATFORM_LEGAL_IDENTITY_REVIEW || grant.data.status !== 'ACTIVE' || grant.data.revokedAt !== null ||
    grant.data.issuer !== p.data.issuer || grant.data.sub !== p.data.sub || grant.data.stage !== p.data.stage)
    throw new AppError(403,'AUTHORITY_REVIEW_NOT_AUTHORIZED');
  return {actor:p.data.sub,check:{ConditionCheck:{TableName:config.PLATFORM_TABLE_NAME,Key:marshall(key),
    ConditionExpression:'entityType = :type AND #data = :grant',ExpressionAttributeNames:{'#data':'data'},
    ExpressionAttributeValues:marshall({':type':'PLATFORM_ADMIN_GRANT',':grant':grant.data})}}};
}
