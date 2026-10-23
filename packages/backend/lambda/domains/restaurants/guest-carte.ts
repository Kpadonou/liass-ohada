import { createHash } from "crypto";
import { z } from "zod";
import {
  GuestCarteResponseSchema,
  GuestCarte,
  MenuCategory,
  MenuItem,
} from "@liass-ohada/shared/restaurants";
import { GuestService } from "./guest-service";
import { RestaurantsRepository as Config } from "./restaurant-repository";
import {
  openReference,
  publicReference,
  sealReference,
} from "./guest-references";

const cursorValue = z
  .object({ menu: z.string().uuid(), cursor: z.string().max(2048) })
  .strict();
const budget = 1024 * 1024;
export class GuestCarteService {
  static async read(capability: string, cursor?: string, ifNoneMatch?: string) {
    const verified = await GuestService.verify(capability);
    if (!("principal" in verified))
      return {
        body: GuestCarteResponseSchema.parse(verified),
        statusCode: 200,
      };
    const p = verified.principal;
    if (!p.rights.includes("CARTE_READ"))
      return { body: { state: "UNAVAILABLE" as const }, statusCode: 200 };
    const menu = await Config.get(p.orgId, "menu", { outletId: p.outletId });
    if (!menu?.data.isActive)
      return { body: { state: "NO_MENU" as const }, statusCode: 200 };
    let start: string | undefined;
    if (cursor) {
      const position = cursorValue.parse(
        JSON.parse((await openReference(p, "continuation", cursor)).value),
      );
      if (position.menu !== menu.data.id)
        throw new Error("Invalid continuation");
      start = position.cursor;
    }
    const window = Math.floor(Date.now() / 900_000) * 900;
    const issuedAt = Math.floor(Date.now() / 1000);
    const categories = new Map<
      string,
      {
        category: MenuCategory;
        items: { item: MenuItem; ref: string; reference: string }[];
      }
    >();
    const knownCategories = new Map<string, MenuCategory>();
    let scanned = 0,
      next = start;
    // At most 500 physical rows per request, including inactive data. Whole 50-row
    // chunks keep bounded cost and a canonical continuation without a new index.
    do {
      const before = next;
      const page = await Config.menuItemsPage(
        p.orgId,
        p.outletId,
        menu.data.id,
        { limit: 50, cursor: next },
      );
      const missingCategories = [
        ...new Set(page.items.map((i) => i.categoryId)),
      ].filter((id) => !knownCategories.has(id));
      if (missingCategories.length) {
        const loaded = await Config.menuCategories(
          p.orgId,
          p.outletId,
          menu.data.id,
          missingCategories,
        );
        for (const [id, category] of loaded) knownCategories.set(id, category);
      }
      const parents = knownCategories;
      const additions = [];
      for (const item of page.items) {
        const category = parents.get(item.categoryId)!;
        if (
          !item.isActive ||
          !category.isActive ||
          item.price.currency !== menu.data.currency
        )
          continue;
        const value = JSON.stringify({
          menuId: menu.data.id,
          menuVersion: menu.data.version,
          categoryId: category.id,
          categoryVersion: category.version,
          itemId: item.id,
          itemVersion: item.version,
        });
        additions.push({
          category,
          item,
          ref: await sealReference(p, "selection", value, issuedAt),
          reference: await publicReference(p, item.id),
        });
      }
      // Roll back only this response chunk if the serialized public budget is reached.
      const prior = new Map(
        [...categories].map(([k, v]) => [
          k,
          { category: v.category, items: [...v.items] },
        ]),
      );
      for (const a of additions) {
        let group = categories.get(a.category.id);
        if (!group) {
          group = { category: a.category, items: [] };
          categories.set(a.category.id, group);
        }
        group.items.push({ item: a.item, ref: a.ref, reference: a.reference });
      }
      if (
        Buffer.byteLength(JSON.stringify([...categories.values()])) >
        budget - 32_768
      ) {
        categories.clear();
        for (const [k, v] of prior) categories.set(k, v);
        next = before;
        break;
      }
      scanned += page.items.length;
      next = page.nextCursor;
    } while (next && scanned < 500);
    const body: GuestCarte = {
      state: "READY",
      currency: menu.data.currency,
      referencesExpireAt: new Date((issuedAt + 900) * 1000).toISOString(),
      categories: [],
      ...(next
        ? {
            nextCursor: await sealReference(
              p,
              "continuation",
              JSON.stringify({ menu: menu.data.id, cursor: next }),
              issuedAt,
            ),
          }
        : {}),
    };
    for (const { category, items } of [...categories.values()].sort(
      (a, b) =>
        (a.category.position ?? 0) - (b.category.position ?? 0) ||
        a.category.name.localeCompare(b.category.name) ||
        a.category.id.localeCompare(b.category.id),
    )) {
      body.categories.push({
        reference: await publicReference(p, category.id),
        name: category.name,
        position: category.position ?? 0,
        items: items
          .sort(
            (a, b) =>
              a.item.name.localeCompare(b.item.name) ||
              a.item.id.localeCompare(b.item.id),
          )
          .map(({ item, ref, reference }) => ({
            reference,
            selectionRef: ref,
            name: item.name,
            amountMinor: item.price.amountMinor,
            availability: item.availability,
          })),
      });
    }
    GuestCarteResponseSchema.parse(body);
    if (Buffer.byteLength(JSON.stringify(body)) > budget)
      throw new Error("Carte response budget exceeded");
    // Weak validators describe semantic equivalence. Random JWE IVs are intentionally
    // excluded; content/configuration changes and each 15-minute reference epoch invalidate the validator.
    const semantic = {
      scope: await publicReference(p, "context"),
      window,
      start: start ?? null,
      next: next ?? null,
      currency: body.currency,
      menu: menu.data,
      groups: [...categories.values()].map((v) => ({
        category: v.category,
        items: v.items.map((i) => i.item),
      })),
    };
    const etag =
      'W/"' +
      createHash("sha256").update(JSON.stringify(semantic)).digest("hex") +
      '"';
    const matches = (ifNoneMatch ?? "")
      .split(",")
      .map((x) => x.trim())
      .some(
        (x) => x === "*" || x.replace(/^W\//, "") === etag.replace(/^W\//, ""),
      );
    return { body, statusCode: matches ? 304 : 200, etag };
  }
}
