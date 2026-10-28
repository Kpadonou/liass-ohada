import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { spawnSync } from "node:child_process";

const script = path.resolve(
  __dirname,
  "../../../scripts/count-cdk-resources.cjs",
);
const policy = require(script) as {
  resourceBudget(
    file: string,
    resources: number,
    otherThreshold?: number,
  ): string;
};
const restaurants =
  "LiassOhadaBackendStackApiStackRestaurantsApiED8E570C.nested.template.json";

test.each([
  [344, "NORMAL"],
  [346, "NORMAL"],
  [374, "NORMAL"],
  [375, "WARNING"],
  [399, "WARNING"],
  [400, "STOP"],
  [500, "STOP"],
])("Restaurants count %s classifies as %s", (count, expected) => {
  expect(policy.resourceBudget(restaurants, Number(count))).toBe(expected);
});
test("generic threshold overrides cannot relax Restaurants policy and other stacks retain the existing guard", () => {
  expect(policy.resourceBudget(restaurants, 400, 999)).toBe("STOP");
  expect(policy.resourceBudget("releases/frozen/" + restaurants, 375)).toBe(
    "WARNING",
  );
  expect(policy.resourceBudget("ApiStack.template.json", 350)).toBe("NORMAL");
  expect(policy.resourceBudget("ApiStack.template.json", 351)).toBe("STOP");
});

test.each([374, 375, 399, 400])(
  "resource guard CLI enforces warning/exit behavior at %s",
  (count) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "restaurants-budget-test-"),
    );
    try {
      fs.writeFileSync(
        path.join(directory, restaurants),
        JSON.stringify({
          Resources: Object.fromEntries(
            Array.from({ length: count }, (_, i) => [
              `Resource${i}`,
              { Type: "AWS::ApiGatewayV2::Route" },
            ]),
          ),
        }),
      );
      const result = spawnSync(process.execPath, [script, directory], {
        encoding: "utf8",
        env: { ...process.env, CDK_RESOURCE_THRESHOLD: "999" },
      });
      expect(result.status).toBe(count >= 400 ? 1 : 0);
      expect(result.stderr.includes("Restaurants resource pressure")).toBe(
        count >= 375 && count < 400,
      );
      expect(
        result.stderr.includes("Stack decomposition/architecture approval"),
      ).toBe(count >= 400);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
