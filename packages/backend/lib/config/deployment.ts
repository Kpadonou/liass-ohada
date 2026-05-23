export const deploymentStages = ["dev", "test", "prod"] as const;

export type DeploymentStage = (typeof deploymentStages)[number];

export const resolveDeploymentStage = (value: unknown): DeploymentStage => {
  if (typeof value === "string" && deploymentStages.includes(value as DeploymentStage)) {
    return value as DeploymentStage;
  }

  throw new Error(
    `Invalid deployment stage "${String(value)}". Expected one of: ${deploymentStages.join(", ")}.`,
  );
};
