export const PLUGIN_ID = "akari";
export const PLUGIN_VERSION = "0.1.2";
export const PACKAGE_NAME = "@bnomei/emdash-akari";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const AKARI_ROUTE_CAPABILITIES = {
  access: "private",
  lexical: "contract",
  structural: "contract",
  metadataFilterSyntax: "akari-indexed-metadata-subset",
  pathSyntax: "akari-json-path-subset",
} as const;
