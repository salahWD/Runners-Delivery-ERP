CREATE TYPE cash_status AS ENUM (
  'DriverCollected',
  'CustomerCollected'
);

ALTER TABLE orders ADD COLUMN cash_status cash_status;
