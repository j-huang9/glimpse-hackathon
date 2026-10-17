export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type Group = {
  id: string;
  name: string;
  invite_code: string;
  cycle_length_days: number;
  next_cycle_length_days: number | null;
  created_by: string | null;
};

export type CycleStatus = "active" | "finalizing" | "revealed" | "empty";

export type Cycle = {
  id: string;
  group_id: string;
  prompt: string;
  starts_at: string;
  ends_at: string;
  status: CycleStatus;
  vibe_label: string | null;
  palette: string[] | null;
  board_url: string | null;
  board_url_landscape: string | null;
  photo_count: number | null;
  /** Board style ("scrapbook" | "film"). Preset by the demo config, otherwise chosen at reveal. */
  theme?: "scrapbook" | "film" | null;
  /** Demo mode only: label to use when there's no AI key (set from seed/config.json). */
  demo_vibe_label?: string | null;
};

export type GroupView = {
  group: Group;
  members: Profile[];
  current: (Cycle & { posted_user_ids: string[]; count: number }) | null;
  latest: Cycle | null;
  me: string;
};
