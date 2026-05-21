
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'ORDER_SHIPPED';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED';
ALTER TYPE public.notification_event_type ADD VALUE IF NOT EXISTS 'ORDER_CLIENT_EDITED';
