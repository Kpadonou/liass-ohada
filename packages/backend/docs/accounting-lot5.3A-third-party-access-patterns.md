# Lot 5.3A Third-Party Access Patterns

## MVP scope

Third-party management supports only these types:

- `CUSTOMER`
- `SUPPLIER`

Future third-party categories such as employees, tax authorities, social
organizations, donors, and miscellaneous debtors or creditors are deferred.
They must be introduced through explicit shared contracts and DynamoDB access
patterns before becoming API-visible.

## Current access patterns

### List third parties by type

- Operation: `Query`
- PK: `KeyFactory.orgKey(orgId)`
- SK condition: `begins_with(SK, KeyFactory.thirdPartyPrefix(type))`
- Pagination: DynamoDB cursor encoded as API cursor
- Status: optional filter after the bounded type query
- Unsupported alternative: no `Scan`

### Lookup third parties by code prefix

- Operation: `Query` third-party code uniqueness locks, then `BatchGetItem`
- PK: `KeyFactory.orgKey(orgId)`
- SK condition: `begins_with(SK, KeyFactory.thirdPartyCodeSK(codePrefix))`
- Lock references: `thirdPartyId` and `thirdPartyType`
- Master resolution: `KeyFactory.thirdPartySK(thirdPartyType, thirdPartyId)`
- Unsupported alternative: no `Scan`

### Direct third-party get/update/status transition

- Operation: `GetItem` or `UpdateItem`
- PK: `KeyFactory.orgKey(orgId)`
- SK: `KeyFactory.thirdPartySK(type, thirdPartyId)`
- `type` is required because it is part of the storage identity.

## Deferred search behavior

Name search is not supported in Lot 5.3A. It requires a dedicated normalized
search key, index, or search service. The API must not emulate name search with
`Scan`.
