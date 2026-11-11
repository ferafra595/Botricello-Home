-- Botricello Home v2: eseguire UNA VOLTA sulla console D1 esistente. Non cancella dati.
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id), amount INTEGER NOT NULL CHECK(amount > 0), method TEXT NOT NULL DEFAULT 'altro', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payments_request ON payments(request_id);
CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_requests_dates ON requests(start_date,end_date,status);
CREATE INDEX IF NOT EXISTS idx_blocks_dates ON blocks(start_date,end_date);
