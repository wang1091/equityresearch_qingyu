import type {
  RequestConfig as SharedRequestConfig,
  RequestPolicy as SharedRequestPolicy,
} from "../http/httpClient";
import type { SupportedDataSource } from "../shared/sourceCatalog";

export type RequestPolicy = SharedRequestPolicy;
export type RequestConfig = SharedRequestConfig;

export interface HttpRequestPlan {
  type: "http";
  request: RequestConfig;
  policy?: Partial<RequestPolicy>;
}

export interface LocalRequestPlan<T = unknown> {
  type: "local";
  value: T | (() => T | Promise<T>);
}

export type RequestPlan<T = unknown> = HttpRequestPlan | LocalRequestPlan<T>;

export type ApiParamsInput = Partial<Record<SupportedDataSource, unknown>>;
