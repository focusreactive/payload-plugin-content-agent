import { isRecord } from "../../borders.js";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { dateOf, nullableDateOf, numberOf, rowOf, stringOf } from "./rows.js";
import { textMatch, textRank } from "./textMatch.js";

export const SHARED_USER_ID = "__shared__";

export interface LtmEntry {
  slug: string;
  userId: string;
  parentSlug: string | null;
  path: string;
  title: string;
  body: string;
  links: Array<{ slug: string; relation: string }>;
  version: number;
  createdBy: string;
  updatedBy: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const isLink = (value: unknown): value is LtmEntry["links"][number] =>
  isRecord(value) && typeof value.slug === "string" && typeof value.relation === "string";

export class LtmStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async create(params: {
    slug: string;
    userId: string;
    parentSlug?: string;
    path: string;
    title: string;
    body: string;
    links?: Array<{ slug: string; relation: string }>;
    createdBy: string;
  }): Promise<LtmEntry> {
    const { rows } = await this.db.query(
      `INSERT INTO ${t("ca_ltm_entries")} (slug, user_id, parent_slug, path, title, body, links, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       ON CONFLICT (user_id, slug) DO UPDATE SET
         title = EXCLUDED.title,
         body = EXCLUDED.body,
         path = EXCLUDED.path,
         parent_slug = EXCLUDED.parent_slug,
         links = EXCLUDED.links,
         updated_by = EXCLUDED.updated_by,
         version = ${t("ca_ltm_entries")}.version + 1,
         archived_at = NULL,
         updated_at = now()
       RETURNING *`,
      [
        params.slug,
        params.userId,
        params.parentSlug ?? null,
        params.path,
        params.title,
        params.body,
        JSON.stringify(params.links ?? []),
        params.createdBy,
      ]
    );

    return this.mapRow(rows[0]);
  }

  async read(userId: string, slug: string): Promise<LtmEntry | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_ltm_entries")}
       WHERE user_id = $1 AND slug = $2 AND archived_at IS NULL`,
      [userId, slug]
    );

    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async update(params: {
    slug: string;
    userId: string;
    title?: string;
    body?: string;
    links?: Array<{ slug: string; relation: string }>;
    updatedBy: string;
    expectedVersion?: number;
  }): Promise<LtmEntry | null> {
    const sets: string[] = ["updated_by = $3", "updated_at = now()", "version = version + 1"];
    const values: unknown[] = [params.userId, params.slug, params.updatedBy];
    let idx = 4;

    if (params.title !== undefined) {
      sets.push(`title = $${idx}`);
      values.push(params.title);
      idx++;
    }

    if (params.body !== undefined) {
      sets.push(`body = $${idx}`);
      values.push(params.body);
      idx++;
    }

    if (params.links !== undefined) {
      sets.push(`links = $${idx}`);
      values.push(JSON.stringify(params.links));
      idx++;
    }

    let where = "user_id = $1 AND slug = $2 AND archived_at IS NULL";

    if (params.expectedVersion !== undefined) {
      where += ` AND version = $${idx}`;
      values.push(params.expectedVersion);
    }

    const { rows } = await this.db.query(
      `UPDATE ${t("ca_ltm_entries")} SET ${sets.join(", ")} WHERE ${where} RETURNING *`,
      values
    );

    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async archive(userId: string, slug: string, updatedBy: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE ${t("ca_ltm_entries")} SET archived_at = now(), updated_by = $3
       WHERE user_id = $1 AND slug = $2 AND archived_at IS NULL`,
      [userId, slug, updatedBy]
    );

    return (rowCount ?? 0) > 0;
  }

  async readWithShared(userId: string, slug: string): Promise<LtmEntry | null> {
    const userEntry = await this.read(userId, slug);

    if (userEntry) return userEntry;

    if (userId !== SHARED_USER_ID) {
      return this.read(SHARED_USER_ID, slug);
    }

    return null;
  }

  async searchWithShared(userId: string, query: string, limit = 10): Promise<LtmEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_ltm_entries")}
       WHERE (user_id = $1 OR user_id = $2) AND archived_at IS NULL
         AND ${textMatch(query, "tsv", "title || ' ' || body", "$3")}
       ORDER BY ${textRank("tsv", "$3")} DESC
       LIMIT $4`,
      [userId, SHARED_USER_ID, query, limit]
    );

    return rows.map(this.mapRow);
  }

  async listAllWithShared(userId: string): Promise<LtmEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_ltm_entries")}
       WHERE (user_id = $1 OR user_id = $2) AND archived_at IS NULL
       ORDER BY path ASC`,
      [userId, SHARED_USER_ID]
    );

    return rows.map(this.mapRow);
  }

  private mapRow(value: unknown): LtmEntry {
    const row = rowOf(value);
    const links: unknown = typeof row.links === "string" ? JSON.parse(row.links) : row.links;

    return {
      slug: stringOf(row.slug) ?? "",
      userId: stringOf(row.user_id) ?? "",
      parentSlug: stringOf(row.parent_slug) ?? null,
      path: stringOf(row.path) ?? "",
      title: stringOf(row.title) ?? "",
      body: stringOf(row.body) ?? "",
      links: Array.isArray(links) ? links.filter(isLink) : [],
      version: numberOf(row.version) ?? 0,
      createdBy: stringOf(row.created_by) ?? "",
      updatedBy: stringOf(row.updated_by) ?? "",
      archivedAt: nullableDateOf(row.archived_at),
      createdAt: dateOf(row.created_at),
      updatedAt: dateOf(row.updated_at),
    };
  }
}
