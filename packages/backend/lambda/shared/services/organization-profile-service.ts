import { GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { OrganizationContactUpdateSchema, OrganizationProfileSchema } from '@liass-ohada/shared/shared';
import { config, dynamoClient } from '../dynamo-client';
import { KeyFactory as K } from '../key-builder';
import { AppError } from '../app-error';
import { OrganizationService } from './organization-service';
import { OrganizationLegalIdentityService } from './organization-legal-identity-service';
import { OrganizationFiscalRepository as Access } from '../repositories/organization-fiscal-repository';
export class OrganizationProfileService {
  static async read(orgId: string, actor: string) {
    const access = await Access.authorize(orgId, actor, false, false);
    const organization = await OrganizationService.getOrganization(orgId);
    if (!organization) throw new AppError(404, 'ERROR_NOT_FOUND');
    const result = await dynamoClient.send(new GetItemCommand({ TableName: config.TABLE_NAME,
      Key: marshall({ PK: K.orgKey(orgId), SK: K.organizationSK() }), ConsistentRead: true }));
    const row = result.Item ? unmarshall(result.Item) : {};
    let legalIdentity = null;
    try {
      const selected = await OrganizationLegalIdentityService.readSelectedIdentity(orgId);
      if (selected.revision.authorityReference === 'ORGANIZATION_ADMIN_ATTESTATION') {
        const { LegalSellerAuthoritySchema } = await import('@liass-ohada/shared/shared');
        const seller = LegalSellerAuthoritySchema.shape.seller.parse(selected.revision.seller);
        legalIdentity = { version: String(selected.revision.identityVersion), name: seller.name,
          ifu: seller.identifiers.find(i => i.scheme === 'IFU' && i.issuingCountry === 'BJ')?.value ?? null,
          address: seller.address ? [...seller.address.lines, seller.address.city, seller.address.postalCode].filter(Boolean).join(', ') : null,
          addressTrust: 'ORGANIZATION_ATTESTED' as const,
          missingEvidence: ['address' as const], selectionVersion: selected.selectionVersion };
      } else {
      const { sellerAuthority: s, selectionVersion } = await OrganizationLegalIdentityService.readSellerIssuanceAuthority(orgId);
      const verified = (p: string) => s.factStates.some(f => f.fieldPath === p && f.state === 'VERIFIED' && f.evidenceReference);
      const selectedIfu = s.seller.identifiers.find((v, i) => v.scheme === 'IFU' && v.issuingCountry === 'BJ' &&
        (verified('identifiers') || ['scheme', 'issuingCountry', 'value'].every(f => verified(`identifiers.${i}.${f}`))));
      const a = s.seller.address;
      const addressVerified = !!a?.lines.length && a.lines.every((_, i) => verified(`address.lines.${i}`)) &&
        (!a.city || verified('address.city')) && (!a.postalCode || verified('address.postalCode'));
      legalIdentity = { authority: s, selectionVersion, version: s.identityVersion, name: s.seller.name,
        ifu: selectedIfu?.value ?? null, address: a ? [...a.lines, a.city, a.postalCode].filter(Boolean).join(', ') : null,
        missingEvidence: [...(!verified('name') ? ['name' as const] : []),
          ...(!selectedIfu ? ['ifu' as const] : []), ...(!addressVerified ? ['address' as const] : [])] };
      }
    } catch (e) { if (!(e instanceof AppError && e.messageCode === 'AUTHORITY_UNAVAILABLE')) throw e; }
    return OrganizationProfileSchema.parse({ organization, canManage: access.canManage,
      contact: row.contact ?? { email: '', phone: '', address: '', city: '', postalCode: '' },
      version: row.contactVersion ?? 0, legalIdentity });
  }
  static async update(orgId: string, actor: string, raw: unknown) {
    if (raw && typeof raw === 'object' && 'legalAddress' in raw) {
      const { z } = await import('zod');
      const { OrganizationLegalAddressSaveSchema } = await import('@liass-ohada/shared/shared');
      const input = z.object({ legalAddress: OrganizationLegalAddressSaveSchema }).strict().parse(raw);
      await OrganizationLegalIdentityService.saveLegalAddress(orgId, actor, input.legalAddress);
      return this.read(orgId, actor);
    }
    await Access.authorize(orgId, actor, true, false);
    const { expectedVersion, contact } = OrganizationContactUpdateSchema.parse(raw);
    try {
      await dynamoClient.send(new TransactWriteItemsCommand({ TransactItems: [Access.membershipCheck(orgId, actor),
        { Update: { TableName: config.TABLE_NAME, Key: marshall({ PK: K.orgKey(orgId), SK: K.organizationSK() }),
          UpdateExpression: 'SET contact = :contact, contactVersion = :next',
          ConditionExpression: 'entityType = :type AND orgId = :org AND (contactVersion = :version OR (attribute_not_exists(contactVersion) AND :version = :zero))',
          ExpressionAttributeValues: marshall({ ':contact': contact, ':next': expectedVersion + 1,
            ':type': 'ORGANIZATION', ':org': orgId, ':version': expectedVersion, ':zero': 0 }) } },
      ] }));
    } catch (e) {
      if ((e as {name?: string}).name === 'TransactionCanceledException') throw new AppError(409, 'FISCAL_COMMAND_CONFLICT');
      throw e;
    }
    return this.read(orgId, actor);
  }
}
