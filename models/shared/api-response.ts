export interface ApiMessage {
  code: string; // Stable, language-independent message code
  message: string; // Localized, human-readable message
}

export interface ApiResponse<T = any> {
  statusCode: number;
  success: boolean;
  message?: ApiMessage;
  data?: T;
  error?: ApiMessage;
}

export const ok = <T>(data: T, message: ApiMessage): ApiResponse<T> => ({
  statusCode: 200,
  success: true,
  message,
  data,
});

export const created = <T>(data: T, message: ApiMessage): ApiResponse<T> => ({
  statusCode: 201,
  success: true,
  message,
  data,
});

export const badRequest = (error: ApiMessage): ApiResponse => ({
  statusCode: 400,
  success: false,
  error,
});

export const unauthorized = (): ApiResponse => ({
  statusCode: 401,
  success: false,
  error: {
    code: "UNAUTHORIZED",
    message: "Unauthorized",
  },
});

export const notFound = (error: ApiMessage): ApiResponse => ({
  statusCode: 404,
  success: false,
  error,
});

export const toLambdaResponse = (
  apiResponse: ApiResponse
): {
  statusCode: number;
  body: string;
  headers: { "Content-Type": string };
} => ({
  statusCode: apiResponse.statusCode,
  body: JSON.stringify(apiResponse),
  headers: {
    "Content-Type": "application/json",
  },
});
