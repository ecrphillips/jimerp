-- Add NOSMOKE to the board_source enum for source_board_products and external_demand tables
ALTER TYPE public.board_source ADD VALUE IF NOT EXISTS 'NOSMOKE';