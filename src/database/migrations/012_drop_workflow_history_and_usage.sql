-- Migration 012: Drop legacy Workflow history and usage tables
-- Phase 1 removes the history feature; Phase 2 appends the usage drops below.

-- History (legacy single-generation log, replaced by Studio sessions/scenes)
drop table if exists history;
