import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { ProductFormat, GrindOption } from '@/types/database';
import { PackagingBadge, PACKAGING_OPTIONS, type PackagingVariant } from '@/components/PackagingBadge';
import { GramPackagingBadge } from '@/components/GramPackagingBadge';
import { ProductTypeChoiceModal } from './ProductTypeChoiceModal';
import { NewSingleOriginProductModal } from './NewSingleOriginProductModal';
import { NewBlendProductModal } from './NewBlendProductModal';
import { SafeDeleteModal } from '@/components/SafeDeleteModal';
import { RoastGroupRerouteModal } from './RoastGroupRerouteModal';
import { Trash2, ChevronRight, ChevronDown, X, Table2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { BulkEditGrid } from '@/components/bulk-edit/BulkEditGrid';
import { useProductsBulkEdit } from '@/components/bulk-edit/configs/products';
import { useBulkEditLogoutCleanup } from '@/components/bulk-edit/useChangeHighlights';
import { useRoastGroupGreenValue } from '@/hooks/useRoastGroupGreenValue';
import { deriveVariantSku } from '@/lib/skuGenerator';
import { sortVariantsByVolume } from '@/lib/productVariantOrder';
import { isCaseLotType, caseLotChoices, caseLotGrams } from '@/lib/caseLots';
import { CaseOnlyToggle } from './CaseOnlyToggle';


interface Product {
  id: string;
  product_name: string;
  sku: string | null;
  format: ProductFormat;
  bag_size_g: number;
  grind_options: GrindOption[];
  is_active: boolean;
  is_perennial: boolean;
  is_placeholder?: boolean | null;
  client_id: string | null;
  account_id: string | null;
  packaging_variant: PackagingVariant | null;
  grams_per_unit: number | null;
  case_lot_product_id: string | null;
  case_lot_units: number | null;
  packaging_type: { name: string } | null;
  roast_group: string | null;
  requires_production: boolean;
  packaging_material_override: number | null;
  packaging_labour_override: number | null;
  client: { name: string } | null;
  account: { account_name: string } | null;

}

const FORMATS: ProductFormat[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER', 'OTHER'];
const GRINDS: GrindOption[] = ['WHOLE_BEAN', 'ESPRESSO', 'FILTER'];


/**
 * Best-effort match from a packaging type name + size onto the legacy
 * packaging_variant enum, so screens that still read the enum keep working.
 * Returns null for combinations the enum can't express — that is fine, the
 * packaging type and grams are the authoritative record.
 */
function legacyVariantFor(typeName: string, grams: number): PackagingVariant | null {
  const n = typeName.toLowerCase();
  const family = n.includes('crowler')
    ? 'CROWLER'
    : n.includes('can')
      ? 'CAN'
      : n.includes('bulk')
        ? 'BULK'
        : n.includes('retail')
          ? 'RETAIL'
          : null;
  if (!family) return null;
  const candidates: Record<string, string> = {
    'RETAIL:250': 'RETAIL_250G', 'RETAIL:300': 'RETAIL_300G',
    'RETAIL:340': 'RETAIL_340G', 'RETAIL:454': 'RETAIL_454G',
    'CROWLER:200': 'CROWLER_200G', 'CROWLER:250': 'CROWLER_250G',
    'CAN:125': 'CAN_125G',
    'BULK:907': 'BULK_2LB', 'BULK:908': 'BULK_2LB', 'BULK:1000': 'BULK_1KG',
    'BULK:2268': 'BULK_5LB', 'BULK:2270': 'BULK_5LB', 'BULK:2000': 'BULK_2KG',
  };
  return (candidates[`${family}:${grams}`] as PackagingVariant) ?? null;
}

function getTodayVancouver(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(now);
}

const PACKAGING_SUFFIXES = [
  '250g Retail', '300g Retail', '340g Retail', '454g Retail',
  '200g Crowler', '250g Crowler', '125g Can',
  '2lb Bulk', '1kg Bulk', '5lb Bulk', '2kg Bulk',
];

/** Compact size label used in product names: 340g, 1kg, 2lb. */
export const formatSizeCompact = (grams: number): string => {
  if (grams === 454) return '1lb';
  if (grams === 907) return '2lb';
  if (grams === 2268) return '5lb';
  if (grams >= 1000 && grams % 1000 === 0) return `${grams / 1000}kg`;
  return `${grams}g`;
};

/** Dropdown label: exact grams, with the friendly equivalent where one exists. */
const formatSizeLabel = (grams: number): string => {
  const compact = formatSizeCompact(grams);
  return compact === `${grams}g` ? `${grams} g` : `${grams} g (${compact})`;
};

const stripPackagingSuffix = (name: string) => {
  let result = name;
  for (const suffix of PACKAGING_SUFFIXES) {
    const re = new RegExp(`[\\s\\-]+${suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    result = result.replace(re, '');
  }
  // Names built from the packaging-types list look like "Base 340g Retail Bag" —
  // strip any trailing "<size> <words>" so variants stay in one family.
  result = result.replace(/[\s\-]+\d+(?:\.\d+)?(?:g|kg|lb)(?:\s+[A-Za-z]+){0,3}$/i, '');
  return result.trim();
};

type StatusFilter = 'active' | 'all' | 'inactive';
type SortMode = 'recent' | 'az' | 'account';

interface ProductFamily {
  baseName: string;
  accountName: string;
  roastGroupName: string;
  origin: string | null;
  variants: Product[];
  activeCount: number;
  lastOrderDate: Date | null;
}

export function ProductsListTab() {
  const queryClient = useQueryClient();
  const { authUser, user } = useAuth();
  const isAdmin = authUser?.role === 'ADMIN';
  const isInternal = authUser?.role === 'ADMIN' || authUser?.role === 'OPS';
  useBulkEditLogoutCleanup(user?.id);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const productsBulk = useProductsBulkEdit(bulkEditOpen);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editCaseContentId, setEditCaseContentId] = useState('');
  const [editCaseUnits, setEditCaseUnits] = useState('');
  const [pricingOverridesOpen, setPricingOverridesOpen] = useState(false);
  const editingGreenValue = useRoastGroupGreenValue(editingProduct?.roast_group ?? null);
  const editingGreenMarketPerKg = editingGreenValue.data?.marketValuePerKg && editingGreenValue.data.marketValuePerKg > 0
    ? editingGreenValue.data.marketValuePerKg
    : null;

  // Product type choice + separate modals
  const [typeChoiceOpen, setTypeChoiceOpen] = useState(false);
  const [singleOriginModalOpen, setSingleOriginModalOpen] = useState(false);
  const [singleOriginCategory, setSingleOriginCategory] = useState<'single' | 'generic'>('single');
  const [blendModalOpen, setBlendModalOpen] = useState(false);
  const [pendingLifecycle, setPendingLifecycle] = useState<'perennial' | 'seasonal' | null>(null);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<{
    open_orders: number;
    completed_orders: number;
    cancelled_orders: number;
  } | null>(null);

  // Roast group reroute modal state
  const [showRerouteModal, setShowRerouteModal] = useState(false);
  const [pendingRerouteData, setPendingRerouteData] = useState<{
    productId: string;
    productName: string;
    currentRoastGroup: string | null;
    newRoastGroup: string | null;
    fullPayload: {
      case_lot_product_id?: string;
      case_lot_units?: number;
      product_name: string;
      sku: string | null;
      format: ProductFormat;
      bag_size_g: number;
      grind_options: GrindOption[];
      client_id: string | null;
      account_id: string | null;
      is_active: boolean;
      is_perennial: boolean;
      packaging_variant: PackagingVariant | null;
      roast_group: string | null;
      requires_production: boolean;
      packaging_material_override: number | null;
      packaging_labour_override: number | null;
    };
  } | null>(null);

  // Add Variant modal state
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [variantSource, setVariantSource] = useState<Product | null>(null);
  const [variantTypeId, setVariantTypeId] = useState<string>('');
  // Size chosen from the existing list, or '__custom__' to type a brand new one.
  const [variantSizeChoice, setVariantSizeChoice] = useState<string>('');
  const [variantCustomGrams, setVariantCustomGrams] = useState<string>('');
  const [variantPrice, setVariantPrice] = useState('');
  const [caseContentId, setCaseContentId] = useState('');
  const [caseUnits, setCaseUnits] = useState('');
  const [caseStep, setCaseStep] = useState(false);

  // Form state (for editing only now)
  const [productName, setProductName] = useState('');
  const [sku, setSku] = useState('');
  const [formatState, setFormatState] = useState<ProductFormat>('WHOLE_BEAN');
  const [bagSize, setBagSize] = useState(340);
  const [grindOptions, setGrindOptions] = useState<GrindOption[]>([]);
  const [clientId, setClientId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [packagingVariant, setPackagingVariant] = useState<PackagingVariant | null>(null);
  const [priceInput, setPriceInput] = useState<string>('');
  const [isPerennial, setIsPerennial] = useState(false);
  const [roastGroup, setRoastGroup] = useState<string>('');
  // "Produced in-house" — off for bought-in items (instant coffee, merch, gear).
  const [requiresProduction, setRequiresProduction] = useState(true);
  const [packagingMaterialOverride, setPackagingMaterialOverride] = useState<string>('');
  const [packagingLabourOverride, setPackagingLabourOverride] = useState<string>('');

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [filterAccount, setFilterAccount] = useState('__all__');
  const [filterRoastGroup, setFilterRoastGroup] = useState('__all__');
  const [filterOrigin, setFilterOrigin] = useState('__all__');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');

  // Expand state
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());

  // ========== Queries ==========

  const { data: products, isLoading } = useQuery({
    queryKey: ['all-products'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, product_name, sku, format, bag_size_g, grams_per_unit, case_lot_product_id, case_lot_units, grind_options, is_active, is_perennial, is_placeholder, client_id, account_id, packaging_variant, packaging_type:packaging_types(name), roast_group, requires_production, packaging_material_override, packaging_labour_override, client:clients(name), account:accounts!products_account_id_fkey(account_name)')
        .order('product_name');

      if (error) throw error;
      return (data ?? []) as unknown as Product[];
    },
  });

  const { data: lastOrderDates } = useQuery({
    queryKey: ['product-last-order-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_line_items')
        .select('product_id, orders(requested_ship_date, created_at)');
      if (error) throw error;
      const map = new Map<string, Date>();
      for (const row of data ?? []) {
        const orders = row.orders as any;
        const dateStr = orders?.requested_ship_date || orders?.created_at;
        if (!dateStr) continue;
        const d = new Date(dateStr);
        const existing = map.get(row.product_id);
        if (!existing || d > existing) {
          map.set(row.product_id, d);
        }
      }
      return map;
    },
  });

  const { data: clients } = useQuery({
    queryKey: ['all-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name')
        .eq('is_active', true)
        .order('account_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: roastGroups } = useQuery({
    queryKey: ['active-roast-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roast_groups')
        .select('roast_group')
        .eq('is_active', true)
        .order('roast_group');
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: allPrices } = useQuery({
    queryKey: ['all-prices'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_list')
        .select('product_id, unit_price, effective_date')
        .order('effective_date', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const currentPrices = useMemo(() => {
    const priceMap: Record<string, number> = {};
    for (const p of allPrices ?? []) {
      if (!(p.product_id in priceMap)) {
        priceMap[p.product_id] = p.unit_price;
      }
    }
    return priceMap;
  }, [allPrices]);

  const productsWithoutPrice = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => !(p.id in currentPrices));
  }, [products, currentPrices]);

  // Packaging types are the master list (managed in Admin Tools → Packaging Types).
  const { data: packagingTypes } = useQuery({
    queryKey: ['packaging-types'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('packaging_types')
        .select('id, name, display_order, is_active')
        .order('display_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  const activePackagingTypes = useMemo(
    () => (packagingTypes ?? []).filter((t) => t.is_active),
    [packagingTypes],
  );

  // Every size already in use, per packaging type, plus a pooled list of all
  // known sizes so a size that exists for one type can be reused on another.
  const { data: variantUsage } = useQuery({
    queryKey: ['packaging-variant-usage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('packaging_type_id, grams_per_unit, bag_size_g, roast_group, account_id');
      if (error) throw error;
      return data ?? [];
    },
    enabled: variantDialogOpen,
  });

  // Sizes offered for the chosen type: sizes already used with that type first,
  // then any other size known anywhere in the catalogue.
  const sizeOptions = useMemo(() => {
    const rows = variantUsage ?? [];
    const forType = new Set<number>();
    const anywhere = new Set<number>();
    for (const r of rows) {
      const g = (r.grams_per_unit ?? r.bag_size_g) as number | null;
      if (!g || g <= 0) continue;
      anywhere.add(g);
      if (variantTypeId && r.packaging_type_id === variantTypeId) forType.add(g);
    }
    const inType = [...forType].sort((a, b) => a - b);
    const others = [...anywhere].filter((g) => !forType.has(g)).sort((a, b) => a - b);
    return { inType, others };
  }, [variantUsage, variantTypeId]);

  // Sizes already taken inside this product family for the chosen type.
  const takenSizes = useMemo(() => {
    const taken = new Set<number>();
    if (!variantSource || !variantTypeId) return taken;
    for (const r of variantUsage ?? []) {
      if (r.packaging_type_id !== variantTypeId) continue;
      if (variantSource.roast_group && r.roast_group !== variantSource.roast_group) continue;
      if (variantSource.account_id && r.account_id !== variantSource.account_id) continue;
      const g = (r.grams_per_unit ?? r.bag_size_g) as number | null;
      if (g && g > 0) taken.add(g);
    }
    return taken;
  }, [variantUsage, variantTypeId, variantSource]);

  // ========== Derived filter options ==========

  const uniqueAccounts = useMemo(() => {
    if (!products) return [];
    const map = new Map<string, string>();
    for (const p of products) {
      const name = p.account?.account_name ?? p.client?.name;
      const id = p.account_id ?? p.client_id;
      if (name && id) map.set(id, name);
    }
    return [...map.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  }, [products]);

  const uniqueRoastGroups = useMemo(() => {
    if (!products) return [];
    const set = new Set<string>();
    for (const p of products) {
      if (p.roast_group) set.add(p.roast_group);
    }
    return [...set].sort();
  }, [products]);

  const uniqueOrigins = useMemo(() => {
    if (!products) return [];
    const set = new Set<string>();
    for (const p of products) {
      // origin join removed for debugging
    }
    return [...set].sort();
  }, [products]);

  // ========== Family grouping + filtering ==========

  const hasActiveFilters = searchText !== '' || filterAccount !== '__all__' || filterRoastGroup !== '__all__' || filterOrigin !== '__all__' || statusFilter !== 'active' || sortMode !== 'recent';

  const clearFilters = () => {
    setSearchText('');
    setFilterAccount('__all__');
    setFilterRoastGroup('__all__');
    setFilterOrigin('__all__');
    setStatusFilter('active');
    setSortMode('recent');
  };

  const families = useMemo(() => {
    if (!products) return [];
    const searchLower = searchText.toLowerCase();

    // Status pre-filter
    const statusFiltered = products.filter((p) => {
      if (statusFilter === 'active') return p.is_active;
      if (statusFilter === 'inactive') return !p.is_active;
      return true;
    });

    // Group by base name + account
    const familyMap = new Map<string, Product[]>();
    for (const p of statusFiltered) {
      const base = stripPackagingSuffix(p.product_name);
      const acctKey = p.account_id ?? p.client_id ?? '__none__';
      const key = `${base}|||${acctKey}`;
      if (!familyMap.has(key)) familyMap.set(key, []);
      familyMap.get(key)!.push(p);
    }

    // Filter families
    const result: ProductFamily[] = [];
    for (const [key, variants] of familyMap) {
      const baseName = key.split('|||')[0];

      // Apply filters — family passes if ANY variant matches all filters
      const matchingVariants = variants.filter((p) => {
        const displayName = p.account?.account_name ?? p.client?.name ?? '';
        // Search
        if (searchLower) {
          const haystack = `${p.product_name} ${p.sku ?? ''} ${displayName} ${baseName}`.toLowerCase();
          if (!haystack.includes(searchLower)) return false;
        }
        // Account
        if (filterAccount !== '__all__') {
          const acctId = p.account_id ?? p.client_id;
          if (acctId !== filterAccount) return false;
        }
        // Roast group
        if (filterRoastGroup !== '__all__' && p.roast_group !== filterRoastGroup) return false;
        // Origin
        if (filterOrigin !== '__all__') return false;
        return true;
      });

      if (matchingVariants.length === 0) continue;

      const first = matchingVariants[0];
      const accountName = first.account?.account_name ?? first.client?.name ?? 'Unknown';
      const roastGroupName = first.roast_group ?? '—';
      const origin = null;

      // Last order date across all variants
      let familyLastOrder: Date | null = null;
      for (const v of matchingVariants) {
        const d = lastOrderDates?.get(v.id);
        if (d && (!familyLastOrder || d > familyLastOrder)) familyLastOrder = d;
      }

      const activeCount = matchingVariants.filter((v) => v.is_active).length;

      result.push({
        baseName,
        accountName,
        roastGroupName,
        origin,
        variants: sortVariantsByVolume(matchingVariants),
        activeCount,
        lastOrderDate: familyLastOrder,
      });
    }

    // Sort
    if (sortMode === 'recent') {
      result.sort((a, b) => {
        if (a.lastOrderDate && b.lastOrderDate) return b.lastOrderDate.getTime() - a.lastOrderDate.getTime();
        if (a.lastOrderDate) return -1;
        if (b.lastOrderDate) return 1;
        return a.baseName.localeCompare(b.baseName);
      });
    } else if (sortMode === 'az') {
      result.sort((a, b) => a.baseName.localeCompare(b.baseName));
    } else {
      result.sort((a, b) => a.accountName.localeCompare(b.accountName) || a.baseName.localeCompare(b.baseName));
    }

    return result;
  }, [products, searchText, filterAccount, filterRoastGroup, filterOrigin, statusFilter, sortMode, lastOrderDates]);

  // ========== Mutations (unchanged) ==========

  const editingCase = !!editingProduct?.case_lot_product_id;
  const editCaseChoices = editingProduct ? caseLotChoices(editingProduct, products ?? []) : [];
  const savedCaseContent = products?.find(p => p.id === editingProduct?.case_lot_product_id);
  if (savedCaseContent && !editCaseChoices.some(p => p.id === savedCaseContent.id)) editCaseChoices.push(savedCaseContent);
  const editCaseContent = editCaseChoices.find(p => p.id === editCaseContentId);
  const editCaseCount = Number(editCaseUnits);
  const editCaseGrams = editCaseContent ? caseLotGrams(editCaseContent.grams_per_unit ?? editCaseContent.bag_size_g, editCaseCount) : 0;

  const executeSaveMutation = useMutation({
    mutationFn: async (payload: {
      case_lot_product_id?: string;
      case_lot_units?: number;
      product_name: string;
      sku: string | null;
      format: ProductFormat;
      bag_size_g: number;
      grind_options: GrindOption[];
      client_id: string | null;
      account_id: string | null;
      is_active: boolean;
      is_perennial: boolean;
      packaging_variant: PackagingVariant | null;
      roast_group: string | null;
      requires_production: boolean;
    }) => {
      let productId: string;
      if (editingProduct) {
        const { error } = await supabase.from('products').update(payload).eq('id', editingProduct.id);
        if (error) throw error;
        productId = editingProduct.id;
      } else {
        const { data: newProduct, error } = await supabase.from('products').insert(payload).select('id').single();
        if (error) throw error;
        productId = newProduct.id;
      }
      const priceValue = parseFloat(priceInput);
      if (!isNaN(priceValue) && priceInput.trim() !== '') {
        const todayVancouver = getTodayVancouver();
        const { error: priceError } = await supabase.from('price_list').insert({
          product_id: productId, unit_price: priceValue, currency: 'CAD', effective_date: todayVancouver,
        });
        if (priceError) {
          console.error('Failed to create price:', priceError);
          toast.error(editingProduct ? 'Product updated but failed to set price' : 'Product created but failed to set initial price');
          return;
        }
      }
    },
    onSuccess: () => {
      const wasReroute = pendingRerouteData !== null;
      toast.success(wasReroute ? 'Product rerouted — roast demand recalculated' : (editingProduct ? 'Product updated' : 'Product created'));
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      queryClient.invalidateQueries({ queryKey: ['roast-demand'] });
      queryClient.invalidateQueries({ queryKey: ['roasted-batches'] });
      queryClient.invalidateQueries({ queryKey: ['pack-demand-all'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-for-pack'] });
      closeDialog();
      setShowRerouteModal(false);
      setPendingRerouteData(null);
    },
    onError: (err) => { console.error(err); toast.error('Failed to save product'); },
  });

  const handleSave = useCallback(() => {
    if (editingCase && !editCaseGrams) {
      toast.error('Select a variant and enter a positive whole-number quantity per case');
      return;
    }
    const trimmedMat = packagingMaterialOverride.trim();
    const matValue = trimmedMat === '' ? null : Number(trimmedMat);
    const trimmedLab = packagingLabourOverride.trim();
    const labValue = trimmedLab === '' ? null : Number(trimmedLab);
    const payload = {
      ...(editingCase ? { case_lot_product_id: editCaseContentId, case_lot_units: editCaseCount } : {}),
      product_name: productName, sku: sku || null, format: formatState, bag_size_g: bagSize,
      grind_options: grindOptions, client_id: editingProduct?.client_id ?? null,
      account_id: clientId || null, is_active: isActive, is_perennial: isPerennial,
      packaging_variant: packagingVariant, roast_group: roastGroup || null,
      requires_production: requiresProduction,
      packaging_material_override: matValue,
      packaging_labour_override: labValue,
    };
    if (editingProduct) {
      const currentRG = editingProduct.roast_group || null;
      const newRG = roastGroup || null;
      if (currentRG !== newRG) {
        setPendingRerouteData({ productId: editingProduct.id, productName: editingProduct.product_name, currentRoastGroup: currentRG, newRoastGroup: newRG, fullPayload: payload });
        setShowRerouteModal(true);
        return;
      }
    }
    executeSaveMutation.mutate(payload);
  }, [editingCase, editCaseGrams, editCaseContentId, editCaseCount, editingProduct, productName, sku, formatState, bagSize, grindOptions, clientId, isActive, isPerennial, packagingVariant, roastGroup, requiresProduction, packagingMaterialOverride, packagingLabourOverride, executeSaveMutation]);

  const handleConfirmReroute = useCallback(() => {
    if (pendingRerouteData) executeSaveMutation.mutate(pendingRerouteData.fullPayload);
  }, [pendingRerouteData, executeSaveMutation]);

  const backfillMutation = useMutation({
    mutationFn: async () => {
      if (productsWithoutPrice.length === 0) throw new Error('No products without price');
      const todayVancouver = getTodayVancouver();
      const priceRows = productsWithoutPrice.map((p) => ({ product_id: p.id, unit_price: 0, currency: 'CAD', effective_date: todayVancouver }));
      const { error } = await supabase.from('price_list').insert(priceRows);
      if (error) throw error;
      return productsWithoutPrice.length;
    },
    onSuccess: (count) => { toast.success(`Set $0.00 price for ${count} product${count > 1 ? 's' : ''}`); queryClient.invalidateQueries({ queryKey: ['all-prices'] }); },
    onError: (err) => { console.error(err); toast.error('Failed to backfill prices'); },
  });

  const deletePreflightMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { data, error } = await supabase.rpc('get_product_delete_preflight', { p_product_id: productId });
      if (error) throw error;
      return data as { open_orders: number; completed_orders: number; cancelled_orders: number };
    },
    onSuccess: (data, productId) => {
      const product = products?.find(p => p.id === productId);
      if (product) { setDeletingProduct(product); setDeleteCounts(data); setShowDeleteModal(true); }
    },
    onError: (err) => { console.error(err); toast.error('Failed to check product references'); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (force: boolean) => {
      if (!deletingProduct) throw new Error('No product selected');
      const { data, error } = await supabase.rpc('delete_product_safe', { p_product_id: deletingProduct.id, p_force: force });
      if (error) throw error;
      return data as { deleted: boolean; message: string };
    },
    onSuccess: (data) => { if (data.deleted) { toast.success('Product deleted'); queryClient.invalidateQueries({ queryKey: ['all-products'] }); queryClient.invalidateQueries({ queryKey: ['all-prices'] }); } },
    onError: (err) => { console.error(err); toast.error('Failed to delete product'); },
  });

  const setInactiveMutation = useMutation({
    mutationFn: async () => {
      if (!deletingProduct) throw new Error('No product selected');
      const { error } = await supabase.from('products').update({ is_active: false }).eq('id', deletingProduct.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Product set to inactive'); queryClient.invalidateQueries({ queryKey: ['all-products'] }); },
    onError: (err) => { console.error(err); toast.error('Failed to set product inactive'); },
  });

  const variantBaseName = variantSource ? stripPackagingSuffix(variantSource.product_name) : '';
  const variantTypeName = activePackagingTypes.find((t) => t.id === variantTypeId)?.name ?? '';
  const isCaseLot = isCaseLotType(variantTypeName);
  const caseChoices = variantSource ? caseLotChoices(variantSource, products ?? []) : [];
  const caseContent = caseChoices.find(p => p.id === caseContentId);
  const caseCount = Number(caseUnits);
  const variantGrams = useMemo(() => {
    if (isCaseLot) return caseContent ? caseLotGrams(caseContent.grams_per_unit ?? caseContent.bag_size_g, caseCount) : 0;
    if (variantSizeChoice === '__custom__') {
      const parsed = parseInt(variantCustomGrams, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    const parsed = parseInt(variantSizeChoice, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [variantSizeChoice, variantCustomGrams, isCaseLot, caseContent, caseCount]);
  const variantIsDuplicate = isCaseLot
    ? caseChoices.length > 0 && (products ?? []).some(p => p.case_lot_product_id === caseContentId && p.case_lot_units === caseCount)
    : variantGrams > 0 && takenSizes.has(variantGrams);
  // Product names hold only the coffee name; size/type live in the packaging
  // fields (and the size badge), same as every other creation screen.
  const variantNewName = variantTypeName && variantGrams > 0 ? variantBaseName : '';

  const addVariantMutation = useMutation({
    mutationFn: async () => {
      if (!variantSource || !variantTypeId || variantGrams <= 0) throw new Error('Missing data');
      if (isCaseLot && !caseContent) throw new Error('Choose a variant for this case.');
      if (variantIsDuplicate) throw new Error('That packaging type and size already exists for this product.');
      const bagSizeG = variantGrams;


      // Derive SKU from a sibling in the same family: clone source SKU and
      // swap its trailing 5-digit grams segment for the new packaging size.
      let derivedSku: string | null = deriveVariantSku(variantSource.sku, bagSizeG);
      if (!derivedSku && variantSource.roast_group) {
        const { data: sibling } = await supabase
          .from('products')
          .select('sku')
          .eq('roast_group', variantSource.roast_group)
          .not('sku', 'is', null)
          .limit(1)
          .maybeSingle();
        derivedSku = deriveVariantSku(sibling?.sku ?? null, bagSizeG);
      }
      // Collision check: if SKU already exists, suffix -2, -3, ...
      if (derivedSku) {
        const baseSku = derivedSku;
        let attempt = baseSku;
        let n = 2;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: clash } = await supabase
            .from('products').select('id').eq('sku', attempt).maybeSingle();
          if (!clash) break;
          attempt = `${baseSku}-${n++}`;
          if (n > 20) { attempt = baseSku; break; }
        }
        derivedSku = attempt;
      }

      const { data: newProduct, error } = await supabase.from('products').insert({
        account_id: variantSource.account_id, product_name: variantNewName, roast_group: variantSource.roast_group,
        packaging_type_id: variantTypeId,
        grams_per_unit: variantGrams,
        case_lot_product_id: isCaseLot ? caseContentId : null,
        case_lot_units: isCaseLot ? caseCount : null,
        // Legacy enum kept in step where the combination has one, so existing
        // badges keep rendering; new combinations simply have none.
        packaging_variant: legacyVariantFor(variantTypeName, variantGrams),
        bag_size_g: bagSizeG, format: variantSource.format as any,
        grind_options: variantSource.grind_options as any, is_perennial: variantSource.is_perennial, is_active: true,
        requires_production: variantSource.requires_production !== false,
        sku: derivedSku,
      } as any).select('id').single();
      if (error) throw error;
      const priceValue = parseFloat(variantPrice);
      if (!isNaN(priceValue) && variantPrice.trim() !== '') {
        await supabase.from('price_list').insert({ product_id: newProduct.id, unit_price: priceValue, currency: 'CAD', effective_date: getTodayVancouver() });
      }
    },
    onSuccess: () => {
      toast.success('Variant added');
      queryClient.invalidateQueries({ queryKey: ['all-products'] });
      queryClient.invalidateQueries({ queryKey: ['all-prices'] });
      queryClient.invalidateQueries({ queryKey: ['packaging-variant-usage'] });
      setVariantDialogOpen(false); setVariantSource(null); setVariantTypeId('');
      setVariantSizeChoice(''); setVariantCustomGrams(''); setVariantPrice('');
      setCaseContentId(''); setCaseUnits(''); setCaseStep(false);
    },
    onError: (err) => { console.error(err); toast.error(err instanceof Error ? err.message : 'Failed to add variant'); },
  });

  // ========== Callbacks ==========

  const openDeleteDialog = useCallback((p: Product) => { deletePreflightMutation.mutate(p.id); }, [deletePreflightMutation]);

  const openNew = () => { setTypeChoiceOpen(true); };
  const handleChooseSingleOrigin = (lifecycle: 'perennial' | 'seasonal') => { setTypeChoiceOpen(false); setPendingLifecycle(lifecycle); setSingleOriginCategory('single'); setSingleOriginModalOpen(true); };
  const handleChooseBlend = (lifecycle: 'perennial' | 'seasonal') => { setTypeChoiceOpen(false); setPendingLifecycle(lifecycle); setBlendModalOpen(true); };
  const handleChooseGeneric = (lifecycle: 'perennial' | 'seasonal') => { setTypeChoiceOpen(false); setPendingLifecycle(lifecycle); setSingleOriginCategory('generic'); setSingleOriginModalOpen(true); };

  const openEdit = async (p: Product) => {
    setEditCaseContentId(p.case_lot_product_id ?? '');
    setEditCaseUnits(p.case_lot_units == null ? '' : String(p.case_lot_units));
    setEditingProduct(p); setProductName(p.product_name); setSku(p.sku ?? '');
    setFormatState(p.format); setBagSize(p.bag_size_g); setGrindOptions(p.grind_options ?? []);
    setClientId(p.account_id ?? p.client_id ?? ''); setIsActive(p.is_active);
    setIsPerennial(p.is_perennial); setPackagingVariant(p.packaging_variant);
    setPriceInput(''); setRoastGroup(p.roast_group ?? '');
    setRequiresProduction(p.requires_production !== false);
    setPackagingMaterialOverride(
      p.packaging_material_override === null || p.packaging_material_override === undefined
        ? ''
        : String(p.packaging_material_override),
    );
    setPackagingLabourOverride(
      p.packaging_labour_override === null || p.packaging_labour_override === undefined
        ? ''
        : String(p.packaging_labour_override),
    );
    setPricingOverridesOpen(false);

    setDialogOpen(true);
  };


  const openAddVariant = (p: Product) => {
    setDialogOpen(false); setEditingProduct(null);
    setVariantSource(p); setVariantTypeId(''); setVariantSizeChoice('');
    setVariantCustomGrams(''); setVariantPrice('');
    setCaseContentId(''); setCaseUnits(''); setCaseStep(false);
    setVariantDialogOpen(true);
  };

  const closeDialog = () => { setDialogOpen(false); setEditingProduct(null); };

  // Auto-open product edit when ?edit=<id> is present in the URL (e.g. from admin audit)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const account = searchParams.get('account');
    if (account) setFilterAccount(account);
  }, [searchParams]);
  useEffect(() => {
    const editId = searchParams.get('edit');
    const section = searchParams.get('section');
    if (!editId || !products) return;
    const target = products.find((p) => p.id === editId);
    if (target) {
      openEdit(target);
      if (section === 'pricing') setPricingOverridesOpen(true);
      // Clear the params so re-renders don't keep reopening
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      next.delete('section');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, searchParams]);

  const toggleGrind = (g: GrindOption) => {
    setGrindOptions((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  };

  const getDisplayName = (p: Product) => p.account?.account_name ?? p.client?.name ?? 'Unknown';

  const toggleFamily = (key: string) => {
    setExpandedFamilies((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ========== Render ==========

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {isAdmin && (
          <Button
            variant={bulkEditOpen ? 'default' : 'outline'}
            onClick={() => setBulkEditOpen((o) => !o)}
            className="gap-1"
          >
            <Table2 className="h-4 w-4" /> {bulkEditOpen ? 'Close Bulk Edit' : 'Bulk Edit'}
          </Button>
        )}
        {productsWithoutPrice.length > 0 && (
          <Button variant="outline" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending}>
            {backfillMutation.isPending ? 'Setting…' : `Set $0.00 for ${productsWithoutPrice.length} unpriced`}
          </Button>
        )}
        <Button onClick={openNew}>Add Product</Button>
      </div>

      {bulkEditOpen && isAdmin ? (
        <BulkEditGrid
          tableKey="products"
          title="Bulk Edit — Products"
          columns={productsBulk.columns}
          rows={productsBulk.rows}
          isLoading={productsBulk.isLoading}
          getRowId={productsBulk.getRowId}
          onCellSave={productsBulk.onCellSave}
          group={productsBulk.group}
          csvFilename={`products-${new Date().toISOString().slice(0, 10)}.csv`}
          onClose={() => setBulkEditOpen(false)}
        />
      ) : (
      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              placeholder="Search name, SKU, account…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-48"
            />
            <Select value={filterAccount} onValueChange={setFilterAccount}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All accounts</SelectItem>
                {uniqueAccounts.map(([id, name]) => (
                  <SelectItem key={id} value={id}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterRoastGroup} onValueChange={setFilterRoastGroup}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All roast groups</SelectItem>
                {uniqueRoastGroups.map((rg) => (
                  <SelectItem key={rg} value={rg}>{rg}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterOrigin} onValueChange={setFilterOrigin}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All origins</SelectItem>
                {uniqueOrigins.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="inactive">Inactive only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Recently used</SelectItem>
                <SelectItem value="az">A–Z</SelectItem>
                <SelectItem value="account">Account</SelectItem>
              </SelectContent>
            </Select>
            {hasActiveFilters && statusFilter === 'active' && sortMode === 'recent' ? null : hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-xs">
                <X className="h-3 w-3" /> Clear filters
              </Button>
            ) : null}
          </div>

          {/* Family list */}
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : families.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                {products && products.length > 0 ? 'No products match your filters.' : 'No products to display.'}
              </p>
              {products && products.length > 0 && (
                <Button variant="link" onClick={clearFilters} className="mt-1">Clear filters</Button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1.25rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_6rem_9rem] items-center gap-3 border-b px-3 pb-1 text-xs font-medium text-muted-foreground">
                <span />
                <span>Product</span>
                <span>Account</span>
                <span className="hidden sm:inline">Roast Group</span>
                <span>Variants</span>
                <span className="text-right">Last order</span>
              </div>
              {families.map((family) => {
                const familyKey = `${family.baseName}|||${family.variants[0]?.account_id ?? family.variants[0]?.client_id ?? ''}`;
                const isOpen = expandedFamilies.has(familyKey);

                return (
                  <Collapsible key={familyKey} open={isOpen} onOpenChange={() => toggleFamily(familyKey)}>
                    <CollapsibleTrigger asChild>
                      <div className="grid grid-cols-[1.25rem_minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_6rem_9rem] items-center gap-3 px-3 py-2 rounded-md cursor-pointer hover:bg-accent/30 transition-colors">
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="font-semibold text-sm truncate">{family.baseName}</span>
                        <span className="text-xs text-muted-foreground truncate">{family.accountName}</span>
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">{family.roastGroupName}</span>
                        <span className="text-xs text-muted-foreground tabular-nums truncate">
                          {family.variants.length} variant{family.variants.length !== 1 ? 's' : ''}
                          {family.activeCount < family.variants.length && ` · ${family.activeCount} active`}
                        </span>
                        <span className="text-xs text-muted-foreground text-right truncate">
                          {family.lastOrderDate ? format(family.lastOrderDate, 'MMM d, yyyy') : 'Never ordered'}
                        </span>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-1 pl-9 pr-2 text-xs font-medium text-muted-foreground">Packaging</th>
                              <th className="pb-1 px-2 text-xs font-medium text-muted-foreground">SKU</th>
                              <th className="pb-1 px-2 text-xs font-medium text-muted-foreground">Price</th>
                              <th className="pb-1 px-2 text-xs font-medium text-muted-foreground">Status</th>
                              <th className="pb-1 px-2 text-xs font-medium text-muted-foreground"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {family.variants.map((p) => {
                              const price = currentPrices[p.id];
                              const hasPrice = p.id in currentPrices;
                              return (
                                <tr key={p.id} className={`border-b last:border-0 bg-muted/20 ${!p.is_active ? 'opacity-60' : ''}`}>
                                  <td className="py-1.5 pl-9 pr-2">
                                    {p.packaging_type?.name && (p.grams_per_unit ?? p.bag_size_g) ? (
                                      <GramPackagingBadge
                                        packagingTypeName={p.packaging_type.name}
                                        gramsPerUnit={p.grams_per_unit ?? p.bag_size_g}
                                      />
                                    ) : p.packaging_variant ? (
                                      <PackagingBadge variant={p.packaging_variant} />
                                    ) : (
                                      <span className="text-muted-foreground text-xs">{p.product_name}</span>
                                    )}
                                    {p.case_lot_product_id && (
                                      <span className="block mt-1 text-xs text-muted-foreground">
                                        {p.case_lot_units} × {formatSizeCompact(products?.find(c => c.id === p.case_lot_product_id)?.bag_size_g ?? 0)}{' '}
                                        {products?.find(c => c.id === p.case_lot_product_id)?.packaging_type?.name}
                                      </span>
                                    )}
                                    {p.case_lot_product_id && p.account_id && <CaseOnlyToggle accountId={p.account_id} productId={p.id} />}
                                  </td>
                                  <td className="py-1.5 px-2 font-mono text-xs">{p.sku || '—'}</td>
                                  <td className="py-1.5 px-2">
                                    {hasPrice ? <span>${price.toFixed(2)}</span> : <span className="text-destructive text-xs font-medium">No price set</span>}
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <Badge variant={p.is_active ? 'default' : 'secondary'} className="text-xs">
                                      {p.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                    {p.is_placeholder && (
                                      <Badge variant="outline" className="ml-1 text-[10px]">PLACEHOLDER</Badge>
                                    )}
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <div className="flex items-center gap-1">
                                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(p)}>Edit</Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openAddVariant(p)}>+ Variant</Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => openDeleteDialog(p)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Edit Product Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b">
            <DialogTitle>{editingCase ? 'Edit Case Lot' : editingProduct ? 'Edit Product' : 'New Product'}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {editingCase && <div className="space-y-4 border-b pb-4">
              <div>
                <Label htmlFor="editCaseContent">Variant in each case</Label>
                <Select value={editCaseContentId} onValueChange={setEditCaseContentId}>
                  <SelectTrigger id="editCaseContent"><SelectValue placeholder="Select variant" /></SelectTrigger>
                  <SelectContent>
                    {editCaseChoices.map(p => <SelectItem key={p.id} value={p.id}>{formatSizeCompact(p.grams_per_unit ?? p.bag_size_g)} {p.packaging_type?.name ?? 'bag'} · {p.sku ?? p.product_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="editCaseUnits">Bags / units per case</Label>
                <Input id="editCaseUnits" type="number" min={1} step={1} value={editCaseUnits} onChange={e => setEditCaseUnits(e.target.value)} />
                {!editCaseGrams && <p className="text-xs text-destructive mt-1">Choose a variant and enter a positive whole number.</p>}
              </div>
              {editCaseGrams > 0 && editCaseContent && <p className="text-sm font-medium">{editCaseCount} × {formatSizeCompact(editCaseContent.grams_per_unit ?? editCaseContent.bag_size_g)} = {formatSizeCompact(editCaseGrams)} per case</p>}
            </div>}
            <div>
              <Label htmlFor="client">Account</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="client"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {clients?.map((c) => (<SelectItem key={c.id} value={c.id}>{c.account_name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="name">Product Name</Label>
              <Input id="name" value={productName} onChange={(e) => setProductName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sku">SKU (optional)</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="format">Format</Label>
                <Select value={formatState} onValueChange={(v) => setFormatState(v as ProductFormat)}>
                  <SelectTrigger id="format"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="bagSize">{editingCase ? 'Case weight (g)' : 'Bag Size (g)'}</Label>
                <Input id="bagSize" type="number" value={editingCase ? editCaseGrams : bagSize} disabled={editingCase} onChange={(e) => setBagSize(parseInt(e.target.value) || 0)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="packagingMaterialOverride">Packaging material override (optional)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="packagingMaterialOverride"
                    type="number"
                    step="0.0001"
                    placeholder="—"
                    value={packagingMaterialOverride}
                    onChange={(e) => setPackagingMaterialOverride(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Per-bag cost of what we supply (bag, label, sticker, etc.). Leave blank to use the default material cost for this packaging variant. Enter 0 if the client supplies their own packaging.
                </p>
              </div>
              <div>
                <Label htmlFor="packagingLabourOverride">Packaging labour override (optional)</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    id="packagingLabourOverride"
                    type="number"
                    step="0.0001"
                    placeholder="—"
                    value={packagingLabourOverride}
                    onChange={(e) => setPackagingLabourOverride(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Per-bag labour cost. Leave blank to use the default labour cost for this packaging variant.
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="packaging">Packaging Variant</Label>
              <Select value={packagingVariant ?? ''} onValueChange={(v) => setPackagingVariant(v as PackagingVariant)}>
                <SelectTrigger id="packaging" disabled={!!editingProduct?.case_lot_product_id}><SelectValue placeholder="Select packaging" /></SelectTrigger>
                <SelectContent>
                  {PACKAGING_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="requiresProduction"
                  checked={requiresProduction}
                  onCheckedChange={(c) => setRequiresProduction(!!c)}
                />
                <Label htmlFor="requiresProduction">Produced in-house</Label>
              </div>
              {!requiresProduction && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Bought-in item. No roasting or packing required — appears on the pack list for attention only.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="roastGroup">Roast Group{!requiresProduction && ' (optional)'}</Label>
              <Select value={roastGroup || 'NONE'} onValueChange={(v) => setRoastGroup(v === 'NONE' ? '' : v)}>
                <SelectTrigger id="roastGroup"><SelectValue placeholder="Select roast group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  {roastGroups?.map((g) => (<SelectItem key={g.roast_group} value={g.roast_group}>{g.roast_group}</SelectItem>))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {requiresProduction
                  ? 'Products sharing the same roast group are roasted together.'
                  : 'Not needed for bought-in items — leave as None.'}
              </p>
            </div>
            <div>
              <Label>Grind Options</Label>
              <div className="mt-2 flex gap-4">
                {GRINDS.map((g) => (
                  <label key={g} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={grindOptions.includes(g)} onCheckedChange={() => toggleGrind(g)} />
                    {g}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="priceInput">{editingProduct ? 'Set New Price (CAD)' : 'Initial Unit Price (CAD)'}</Label>
              {editingProduct && editingProduct.id in currentPrices && (
                <p className="text-xs text-muted-foreground mb-1">Current: ${currentPrices[editingProduct.id].toFixed(2)}</p>
              )}
              {editingProduct && !(editingProduct.id in currentPrices) && (
                <p className="text-xs text-destructive mb-1">No price set — product cannot be ordered</p>
              )}
              <Input id="priceInput" type="number" step="0.01" min="0" placeholder="e.g. 12.50 or 0.00" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                {editingProduct ? 'Leave blank to keep current price. Enter a value to create a new price entry.' : 'Leave blank to set later. $0.00 is allowed.'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Checkbox id="active" checked={isActive} onCheckedChange={(c) => setIsActive(!!c)} />
                <Label htmlFor="active">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="perennial" checked={isPerennial} onCheckedChange={(c) => setIsPerennial(!!c)} />
                <Label htmlFor="perennial">Perennial</Label>
              </div>
            </div>

            {/* Pricing lives on the pricing sheet, which is the only surface
                that builds a price from a visible cost floor. */}
            {isInternal && editingProduct && (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Pricing</p>
                <p className="text-xs text-muted-foreground">
                  Prices are built on the pricing sheet, where the cost floor and every rate behind
                  it are visible. Build a line there and save it to this product.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link to="/accounts/pricing">Open the pricing sheet</Link>
                </Button>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 flex justify-between items-center px-6 py-4 border-t bg-background">
            {editingProduct ? (
              <Button variant="secondary" onClick={() => openAddVariant(editingProduct)}>Add Variant</Button>
            ) : <div />}
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSave} disabled={executeSaveMutation.isPending || !productName || !clientId || (editingCase && !editCaseGrams)}>
                {executeSaveMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Variant Dialog */}
      <Dialog open={variantDialogOpen} onOpenChange={setVariantDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{caseStep ? 'Case Lot — Contents' : 'Add Variant'}</DialogTitle></DialogHeader>
          {variantSource && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/50 text-sm space-y-1">
                <p><span className="font-medium">Product:</span> {variantSource.product_name}</p>
                <p><span className="font-medium">Account:</span> {getDisplayName(variantSource)}</p>
              </div>
              {variantNewName && (
                <div className="rounded-md border border-dashed p-2 bg-muted/30 text-sm">
                  <span className="text-muted-foreground">New product:</span>{' '}
                  <span className="font-medium">{variantNewName}</span>
                  <span className="text-muted-foreground"> — {formatSizeCompact(variantGrams)} {variantTypeName}</span>
                </div>
              )}
              {!caseStep && <div>
                <Label>Packaging type</Label>
                <Select
                  value={variantTypeId}
                  onValueChange={(v) => { setVariantTypeId(v); setVariantSizeChoice(''); setVariantCustomGrams(''); setCaseContentId(''); setCaseUnits(''); setCaseStep(false); }}
                >
                  <SelectTrigger><SelectValue placeholder="Select packaging type" /></SelectTrigger>
                  <SelectContent>
                    {activePackagingTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Types are managed in Admin Tools → Packaging Types.
                </p>
              </div>}

              {!isCaseLot && <div>
                <Label>Size</Label>
                <Select
                  value={variantSizeChoice}
                  onValueChange={setVariantSizeChoice}
                  disabled={!variantTypeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={variantTypeId ? 'Select a size' : 'Choose a packaging type first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sizeOptions.inType.map((g) => (
                      <SelectItem key={`in-${g}`} value={String(g)} disabled={takenSizes.has(g)}>
                        {formatSizeLabel(g)}{takenSizes.has(g) ? ' — already on this product' : ''}
                      </SelectItem>
                    ))}
                    {sizeOptions.others.length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Other sizes used elsewhere
                        </div>
                        {sizeOptions.others.map((g) => (
                          <SelectItem key={`other-${g}`} value={String(g)} disabled={takenSizes.has(g)}>
                            {formatSizeLabel(g)}
                          </SelectItem>
                        ))}
                      </>
                    )}
                    <SelectItem value="__custom__">New size…</SelectItem>
                  </SelectContent>
                </Select>
                {variantSizeChoice === '__custom__' && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      placeholder="grams"
                      className="w-28"
                      value={variantCustomGrams}
                      onChange={(e) => setVariantCustomGrams(e.target.value)}
                    />
                    <span className="text-sm text-muted-foreground">
                      g{variantGrams > 0 ? ` — ${formatSizeCompact(variantGrams)}` : ''}
                    </span>
                  </div>
                )}
                {variantIsDuplicate && (
                  <p className="text-xs text-destructive mt-1">
                    This product already has a {variantTypeName} at {formatSizeCompact(variantGrams)}.
                  </p>
                )}
              </div>}
              {isCaseLot && caseStep && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="caseContent">Variant in each case</Label>
                    <Select value={caseContentId} onValueChange={setCaseContentId}>
                      <SelectTrigger id="caseContent"><SelectValue placeholder="Select variant" /></SelectTrigger>
                      <SelectContent>
                        {caseChoices.map(p => <SelectItem key={p.id} value={p.id}>{formatSizeCompact(p.grams_per_unit ?? p.bag_size_g)} {p.packaging_type?.name ?? 'bag'} · {p.sku ?? p.product_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {caseChoices.length === 0 && <p className="mt-1 text-sm text-destructive">No active variants available in this product group.</p>}
                  </div>
                  <div>
                    <Label htmlFor="caseUnits">Bags / units per case</Label>
                    <Input id="caseUnits" type="number" min={1} step={1} value={caseUnits} onChange={e => setCaseUnits(e.target.value)} placeholder="e.g. 12" />
                    {caseUnits && !caseLotGrams(1, caseCount) && <p className="text-xs text-destructive mt-1">Enter a positive whole number.</p>}
                  </div>
                  {variantGrams > 0 && caseContent && <p className="text-sm font-medium">{caseCount} × {formatSizeCompact(caseContent.grams_per_unit ?? caseContent.bag_size_g)} = {formatSizeCompact(variantGrams)} per case</p>}
                  {variantIsDuplicate && <p className="text-sm text-destructive">A case with this variant and quantity already exists.</p>}
                </div>
              )}
              {(!isCaseLot || caseStep) && <div>
                <Label htmlFor="variantPrice">{isCaseLot ? 'Price per case' : 'Unit Price'} (CAD, optional)</Label>
                <Input id="variantPrice" type="number" step="0.01" min="0" placeholder="e.g. 12.50" value={variantPrice} onChange={(e) => setVariantPrice(e.target.value)} />
              </div>}
              <div className="flex justify-end gap-2 pt-2">
                {caseStep && <Button variant="outline" onClick={() => setCaseStep(false)}>Back</Button>}
                <Button variant="outline" onClick={() => setVariantDialogOpen(false)}>Cancel</Button>
                {isCaseLot && !caseStep ? <Button onClick={() => setCaseStep(true)}>Next: Case contents</Button> :
                <Button
                  onClick={() => addVariantMutation.mutate()}
                  disabled={addVariantMutation.isPending || !variantTypeId || variantGrams <= 0 || variantIsDuplicate}
                >
                  {addVariantMutation.isPending ? 'Saving…' : 'Save'}
                </Button>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ProductTypeChoiceModal open={typeChoiceOpen} onOpenChange={setTypeChoiceOpen} onChooseSingleOrigin={handleChooseSingleOrigin} onChooseBlend={handleChooseBlend} onChooseGeneric={handleChooseGeneric} />
      <NewSingleOriginProductModal open={singleOriginModalOpen} onOpenChange={setSingleOriginModalOpen} initialLifecycle={pendingLifecycle} category={singleOriginCategory} />
      <NewBlendProductModal open={blendModalOpen} onOpenChange={setBlendModalOpen} />

      <SafeDeleteModal
        open={showDeleteModal} onOpenChange={setShowDeleteModal} entityType="product"
        entityName={deletingProduct?.product_name ?? ''} counts={deleteCounts}
        isLoading={deleteMutation.isPending || setInactiveMutation.isPending}
        onSetInactive={() => setInactiveMutation.mutate()} onConfirmDelete={() => deleteMutation.mutate(true)}
      />

      <RoastGroupRerouteModal
        open={showRerouteModal}
        onOpenChange={(open) => { setShowRerouteModal(open); if (!open) setPendingRerouteData(null); }}
        productName={pendingRerouteData?.productName ?? ''}
        currentRoastGroup={pendingRerouteData?.currentRoastGroup ?? null}
        newRoastGroup={pendingRerouteData?.newRoastGroup ?? null}
        onConfirm={handleConfirmReroute}
        isPending={executeSaveMutation.isPending}
      />
    </div>
  );
}
