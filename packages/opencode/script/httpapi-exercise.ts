// The isolated route exerciser uses its own local test/test-model provider.
process.env.MUC_ALLOW_ALL_PROVIDERS = "1"
await import("../test/server/httpapi-exercise/index")
