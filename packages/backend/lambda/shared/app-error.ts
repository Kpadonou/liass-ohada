export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly messageCode: string,
    public readonly details?: any,
  ) {
    super(messageCode);
    this.name = "AppError";
  }
}
