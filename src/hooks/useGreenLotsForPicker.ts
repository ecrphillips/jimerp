import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { LotForLabel } from '@/components/quotes/lotLabel';

/**
 * Shared green-lot lookup that mirrors the Calculator tab's data shape.
 * Resolves origin (contracts -> purchase line override) and producer (purchase line).
 */
export function useGreenLotsForPicker() {
  return useQuery<(LotForLabel & { status: string })[]>({
    queryKey: ['quote-green-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('green_lots')
        .select(`
          id, lot_number, lot_identifier, book_value_per_kg, status,
          green_contracts ( origin_country )
        `)
        .order('lot_number', { ascending: false });
      if (error) throw error;

      const rows = data ?? [];
      const lotIds = rows.map((r: any) => r.id);
      const producerByLot: Record<string, string | null> = {};
      const originByLot: Record<string, string | null> = {};
      if (lotIds.length > 0) {
        const { data: pls, error: plErr } = await supabase
          .from('green_purchase_lines')
          .select('lot_id, producer, origin_country')
          .in('lot_id', lotIds);
        if (plErr) throw plErr;
        (pls ?? []).forEach((pl: any) => {
          if (!pl.lot_id) return;
          if (pl.producer && !producerByLot[pl.lot_id]) producerByLot[pl.lot_id] = pl.producer;
          if (pl.origin_country && !originByLot[pl.lot_id]) originByLot[pl.lot_id] = pl.origin_country;
        });
      }

      return rows.map((r: any) => ({
        id: r.id,
        lot_number: r.lot_number,
        lot_identifier: r.lot_identifier ?? null,
        book_value_per_kg: r.book_value_per_kg,
        status: r.status,
        origin_country: originByLot[r.id] || r.green_contracts?.origin_country || null,
        producer: producerByLot[r.id] || null,
      }));
    },
  });
}
