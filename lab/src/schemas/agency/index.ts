// A headless CMS agency site: every field type, blocks three levels deep, two locales, many documents.
import type { LabSchema } from "../types";
import { collections } from "./collections";
import { globals } from "./globals";
import { seedAgency } from "./seed";

export const agency: LabSchema = {
  name: "agency",
  collections,
  globals,
  localization: { locales: ["en", "es"], defaultLocale: "en" },
  seed: seedAgency,
};
