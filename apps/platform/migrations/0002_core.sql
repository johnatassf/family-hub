-- Núcleo multi-família: famílias, membros, convites e auditoria.

CREATE TABLE households (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX household_members_user_idx ON household_members(user_id);

-- Convite preso ao e-mail: só quem comprova o e-mail (Google, código ou verificação) entra.
CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,            -- sempre minúsculo
  role         TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by   TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  accepted_at  TEXT,
  revoked_at   TEXT
);
CREATE INDEX invites_email_idx ON invites(email);
CREATE INDEX invites_household_idx ON invites(household_id);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT,
  user_id      TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  details      TEXT,                     -- JSON
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX audit_log_household_idx ON audit_log(household_id, created_at);
CREATE INDEX audit_log_user_idx ON audit_log(user_id, created_at);
