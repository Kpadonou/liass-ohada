import { RestaurantsService as service } from "@/lambda/domains/restaurants/restaurant-service";
import { fixtureId } from "./memory-dynamo";
/** Deterministic names/request IDs; QR tokens intentionally remain cryptographically random. */
export async function acceptanceFixture(orgId = "org-resto") {
  let sequence = 0;
  const request = (name: string) => ({
    name,
    clientRequestId: fixtureId(++sequence),
  });
  const restaurant = await service.create(
    orgId,
    "owner",
    "restaurant",
    {},
    request("Héritage Bistro"),
  );
  const outlet = await service.create(
    orgId,
    "owner",
    "outlet",
    {},
    request("Agla"),
  );
  const context = { outletId: outlet.id };
  const areas = [];
  for (const name of ["Main Room", "Terrace"])
    areas.push(
      await service.create(
        orgId,
        "owner",
        "serviceArea",
        context,
        request(name),
      ),
    );
  const tables = [];
  for (let i = 0; i < 4; i++) {
    const code = `T0${i + 1}`;
    tables.push(
      await service.create(
        orgId,
        "owner",
        "table",
        { ...context, serviceAreaId: areas[i % 2].id },
        { ...request(code), code, capacity: 4 },
      ),
    );
  }
  const stations = [];
  for (const name of ["KITCHEN", "BAR"])
    stations.push(
      await service.create(orgId, "owner", "station", context, request(name)),
    );
  const menu = await service.create(orgId, "owner", "menu", context, {
    ...request("Agla Menu"),
    currency: "XOF",
  });
  const categories = [];
  for (const name of ["Main Dishes", "Drinks", "Desserts"])
    categories.push(
      await service.create(orgId, "owner", "category", context, request(name)),
    );
  const entries = [
    ["Grilled Chicken", 0, 0, 5000, false],
    ["Fried Plantain", 0, 0, 1500, false],
    ["Bottled Water", 1, 1, 500, true],
    ["Beer", 1, 1, 1000, true],
    ["Chocolate Cake", 2, undefined, 2000, false],
  ] as const;
  const items = [];
  for (const [
    name,
    category,
    station,
    amountMinor,
    guestReorderEnabled,
  ] of entries) {
    items.push(
      await service.create(
        orgId,
        "owner",
        "item",
        { ...context, categoryId: categories[category].id },
        {
          ...request(name),
          price: { amountMinor, currency: "XOF" },
          guestReorderEnabled,
          ...(station === undefined
            ? {}
            : { preparationStationId: stations[station].id }),
        },
      ),
    );
  }
  return {
    restaurant,
    outlet,
    areas,
    tables,
    stations,
    menu,
    categories,
    items,
  };
}
