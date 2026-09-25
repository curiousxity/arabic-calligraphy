import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// Runs only the demo recorder, one test at a time so recordings don't compete.
export default defineConfig({
  ...base,
  testDir: ".",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
