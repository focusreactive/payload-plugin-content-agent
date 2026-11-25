import { isRecord } from "../../borders.js";
import { t } from "../database.js";
import type { DatabasePool } from "../database.js";
import { rowOf, stringOf } from "./rows.js";

export interface Task {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  blockedReason?: string;
}

const isTaskStatus = (value: unknown): value is Task["status"] =>
  value === "pending" || value === "in_progress" || value === "completed" || value === "blocked";

const isTask = (value: unknown): value is Task =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.content === "string" &&
  isTaskStatus(value.status) &&
  (value.blockedReason === undefined || typeof value.blockedReason === "string");

export interface PresentState {
  conversationId: string;
  mission: string | null;
  status: string | null;
  tasks: Task[];
}

export class PresentStateStorage {
  private db: DatabasePool;

  constructor(db: DatabasePool) {
    this.db = db;
  }

  async get(conversationId: string): Promise<PresentState | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM ${t("ca_present_state")} WHERE conversation_id = $1`,
      [conversationId]
    );

    if (!rows[0]) return null;

    return this.mapRow(rows[0]);
  }

  async setMission(conversationId: string, mission: string): Promise<void> {
    await this.db.query(
      `INSERT INTO ${t("ca_present_state")} (conversation_id, mission)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id)
       DO UPDATE SET mission = $2`,
      [conversationId, mission]
    );
  }

  async setStatus(conversationId: string, status: string): Promise<void> {
    await this.db.query(
      `INSERT INTO ${t("ca_present_state")} (conversation_id, status)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id)
       DO UPDATE SET status = $2`,
      [conversationId, status]
    );
  }

  async updateTasks(conversationId: string, tasks: Task[]): Promise<void> {
    await this.db.query(
      `INSERT INTO ${t("ca_present_state")} (conversation_id, tasks)
       VALUES ($1, $2)
       ON CONFLICT (conversation_id)
       DO UPDATE SET tasks = $2`,
      [conversationId, JSON.stringify(tasks)]
    );
  }

  private mapRow(value: unknown): PresentState {
    const row = rowOf(value);
    const tasks: unknown = typeof row.tasks === "string" ? JSON.parse(row.tasks) : row.tasks;

    return {
      conversationId: stringOf(row.conversation_id) ?? "",
      mission: stringOf(row.mission) ?? null,
      status: stringOf(row.status) ?? null,
      tasks: Array.isArray(tasks) ? tasks.filter(isTask) : [],
    };
  }
}
