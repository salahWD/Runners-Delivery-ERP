CREATE TYPE cashbox_transaction_type AS ENUM ('IN', 'OUT');

CREATE TABLE IF NOT EXISTS public.cashbox_transactions (
  id uuid not null default gen_random_uuid (),
  type public.cashbox_transaction_type not null,
  amount_usd numeric null default 0,
  amount_lbp numeric null default 0,
  third_party_id uuid null,
  driver_id uuid null,
  client_id uuid null,
  order_ref text null,
  note text null,
  ts timestamp with time zone null default now(),
  constraint cashbox_transactions_pkey primary key (id),
  -- constraint cashbox_transactions_client_id_fkey foreign KEY (client_id) references clients (id) on delete CASCADE,
  -- constraint cashbox_transactions_driver_id_fkey foreign KEY (driver_id) references drivers (id) on delete CASCADE,
  -- constraint cashbox_transactions_third_party_id_fkey foreign KEY (third_party_id) references third_parties (id) on delete CASCADE
) TABLESPACE pg_default;

CREATE OR REPLACE FUNCTION public.add_cashbox_transaction(
  transaction_type public.cashbox_transaction_type,
  amount_usd numeric DEFAULT 0,
  amount_lbp numeric DEFAULT 0,
  note text DEFAULT null,
  order_ref text DEFAULT null,
  driver_id text DEFAULT null,
  client_id text DEFAULT null,
  third_party_id text DEFAULT null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'operator')) THEN
    RAISE EXCEPTION 'Insufficient permissions: admin or operator role required';
  END IF;

  INSERT INTO public.cashbox_transactions
    (type, amount_usd, amount_lbp, third_party_id, driver_id, client_id, order_ref, note, ts)
  VALUES
    (transaction_type, amount_usd, amount_lbp, third_party_id::uuid, driver_id::uuid, client_id::uuid, order_ref, note, now());
END;
$$;