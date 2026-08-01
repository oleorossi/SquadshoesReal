import { useState, useEffect, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Truck, Trash as Trash2, CircleNotch as Loader2, NavigationArrow as Navigation, MagnifyingGlass as Search, Check, Storefront as Store, ArrowCounterClockwise as RotateCcw, ClipboardText as ClipboardList, Warning as AlertTriangle, Eraser } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  PRODUCTION_STATUSES,
  normalizeRouteText,
  normalizeRouteDigits,
  getRouteClientIssues,
  resolveOrdersToClients,
  type RouteClientRecord,
  type RouteOrderRecord,
} from '@/lib/logistics/routeManagement';

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

interface RouteStop {
  label: string;
  coords: [number, number];
  kind: 'factory' | 'client';
}

interface RouteLeg {
  from: string;
  to: string;
  distanceKm: number;
  durationMin: number;
}

interface RouteData {
  distance: number;
  duration: number;
  geometry: [number, number][];
  optimizedOrder: string[];
  orderedStops: RouteStop[];
  legs: RouteLeg[];
  isRoundtrip: boolean;
}

interface ClientOption extends RouteClientRecord {
  routeIssues: string[];
  routeReady: boolean;
}

interface CepLookupResult {
  street: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
}

const normalizeText = normalizeRouteText;
const normalizeDigits = normalizeRouteDigits;

const cleanStreetForGeocoding = (street: string) =>
  street
    .replace(/\s+-\s+.*$/g, '')
    .replace(/\b(LOJA|LJ|SALA|SL|BOX|BLOCO|QD|QUADRA|LT|LOTE|GALPAO|GALPÃO|SUBSOLO|SOBRADO|FUNDOS)\b.*$/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/, '')
    .trim();

const extractStreetNumber = (street: string) => {
  const sanitized = street.replace(/\s+-\s+.*$/g, '');
  const match = sanitized.match(/,\s*([^,]+)$/);
  const value = match?.[1]?.trim() || '';
  return /^\d/.test(value) ? value : '';
};

const buildStreetWithNumber = (street: string, number: string) => {
  const cleanStreet = cleanStreetForGeocoding(street);
  if (!cleanStreet) return '';
  const lastSegment = cleanStreet.split(',').pop()?.trim() || '';
  if (/^\d/.test(lastSegment)) return cleanStreet;
  return number ? `${cleanStreet}, ${number}` : cleanStreet;
};

const resolveResultCity = (address: Record<string, unknown>) =>
  String(address.city || address.town || address.village || address.municipality || address.county || '');

const scoreGeocodeResult = (
  result: any,
  target: { cidade: string; estado: string; bairro: string; cep: string }
) => {
  const address = result.address || {};
  const resultCity = normalizeText(resolveResultCity(address));
  const resultStateName = normalizeText(String(address.state || ''));
  const resultStateCode = normalizeText(String(address['ISO3166-2-lvl4'] || '').replace('BR-', ''));
  const resultBairro = normalizeText(
    String(address.suburb || address.neighbourhood || address.city_district || address.quarter || '')
  );
  const resultCep = normalizeDigits(String(address.postcode || ''));

  const targetCity = normalizeText(target.cidade || '');
  const targetState = normalizeText(target.estado || '');
  const targetBairro = normalizeText(target.bairro || '');
  const targetCep = normalizeDigits(target.cep || '');

  const cityMatches = !targetCity || resultCity.includes(targetCity) || targetCity.includes(resultCity);
  const stateMatches =
    !targetState ||
    resultStateName.includes(targetState) ||
    targetState.includes(resultStateName) ||
    resultStateCode === targetState;

  if (!cityMatches || !stateMatches) return 0;

  let score = 10;
  if (targetBairro && resultBairro && (resultBairro.includes(targetBairro) || targetBairro.includes(resultBairro))) score += 3;
  if (targetCep && resultCep && (targetCep === resultCep || targetCep.slice(0, 5) === resultCep.slice(0, 5))) score += 2;
  return score;
};

const pickBestGeocodeResult = (
  results: any[],
  target: { cidade: string; estado: string; bairro: string; cep: string }
) => {
  if (!target.cidade && !target.estado) return results[0] ?? null;

  const ranked = results
    .map((result) => ({ result, score: scoreGeocodeResult(result, target) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.result ?? null;
};

async function fetchCepLookup(cep: string): Promise<CepLookupResult | null> {
  const cleanCep = normalizeDigits(cep);
  if (cleanCep.length !== 8) return null;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;

    const data = await response.json();
    if (data?.erro) return null;

    return {
      street: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      estado: data.uf || '',
      cep: normalizeDigits(data.cep || cleanCep),
    };
  } catch {
    return null;
  }
}

function LeafletMap({ routeData }: { routeData: RouteData | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const layerGroup = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const map = L.map(mapRef.current).setView([-22.9068, -43.1729], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    layerGroup.current = L.layerGroup().addTo(map);
    mapInstance.current = map;

    return () => {
      map.remove();
      mapInstance.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !layerGroup.current) return;

    layerGroup.current.clearLayers();
    if (!routeData) return;

    const polyline = L.polyline(routeData.geometry, { color: 'hsl(var(--primary))', weight: 4 });
    layerGroup.current.addLayer(polyline);

    routeData.orderedStops.forEach((stop, index) => {
      const popupText =
        stop.kind === 'factory'
          ? '🏭 Fábrica (Saída)'
          : `📍 ${index}. ${stop.label}`;

      const marker = L.marker(stop.coords).bindPopup(popupText);
      layerGroup.current!.addLayer(marker);
    });

    if (routeData.geometry.length > 0) {
      mapInstance.current.fitBounds(L.latLngBounds(routeData.geometry), { padding: [30, 30] });
    }
  }, [routeData]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />;
}

const ROUTE_STORAGE_KEY = 'route-optimizer-state';

interface PersistedRouteState {
  origin: string;
  costPerKm: string;
  isOwnTransport: boolean;
  selectedClientIds: string[];
}

function loadPersistedRoute(): Partial<PersistedRouteState> {
  try {
    const raw = localStorage.getItem(ROUTE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePersistedRoute(state: PersistedRouteState) {
  try { localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function RouteOptimizerPanel() {
  const persisted = useRef(loadPersistedRoute()).current;

  const [origin, setOrigin] = useState(persisted.origin ?? 'Rio de Janeiro, RJ');
  const [costPerKm, setCostPerKm] = useState(persisted.costPerKm ?? '1.50');
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isOwnTransport, setIsOwnTransport] = useState(persisted.isOwnTransport ?? true);

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [selectedClients, setSelectedClients] = useState<ClientOption[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [orderClients, setOrderClients] = useState<ClientOption[]>([]);
  const [blockedOrderClients, setBlockedOrderClients] = useState<ClientOption[]>([]);
  const [unresolvedOrders, setUnresolvedOrders] = useState<string[]>([]);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  const [orderPopoverOpen, setOrderPopoverOpen] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Persist key fields on change
  useEffect(() => {
    savePersistedRoute({
      origin,
      costPerKm,
      isOwnTransport,
      selectedClientIds: selectedClients.map((c) => c.id),
    });
  }, [origin, costPerKm, isOwnTransport, selectedClients]);

  const loadOrderClients = async () => {
    setLoadingOrders(true);
    try {
      const { data: orders, error } = await supabase
        .from('sale_orders')
        .select('order_number, client_id, client_name, client_cnpj')
        .in('status', [...PRODUCTION_STATUSES]);

      if (error) throw error;

      if (!orders || orders.length === 0) {
        toast.info('Nenhum pedido em produção encontrado');
        setOrderClients([]);
        setBlockedOrderClients([]);
        setUnresolvedOrders([]);
        return;
      }

      const resolved = resolveOrdersToClients(orders, clients);
      setOrderClients(resolved.readyClients);
      setBlockedOrderClients(resolved.blockedClients);
      setUnresolvedOrders(resolved.unresolvedOrders);

      if (resolved.readyClients.length === 0 && (resolved.blockedClients.length > 0 || resolved.unresolvedOrders.length > 0)) {
        toast.warning('Existem pedidos em produção, mas nenhuma loja está com cadastro completo para rota.');
      }
    } catch {
      toast.error('Erro ao buscar pedidos em produção');
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    const loadClients = async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, cnpj, razao_social, nome_fantasia, endereco, bairro, cidade, estado, cep')
        .eq('active', true)
        .order('razao_social');

      if (data) {
        const mapped = (data as any[]).map((client) => {
          const issues = getRouteClientIssues({
            cidade: client.cidade || '',
            estado: client.estado || '',
            street: client.endereco || '',
            address: '',
            cep: client.cep || '',
          });
          return {
            id: client.id,
            label: client.nome_fantasia || client.razao_social || 'Loja sem nome',
            razaoSocial: client.razao_social || '',
            nomeFantasia: client.nome_fantasia || '',
            cnpj: client.cnpj || '',
            address: [client.endereco, client.bairro, client.cidade, client.estado, client.cep].filter(Boolean).join(', '),
            street: client.endereco || '',
            cidade: client.cidade || '',
            bairro: client.bairro || '',
            estado: client.estado || '',
            cep: client.cep || '',
            routeIssues: issues,
            routeReady: issues.length === 0,
          };
        });

        setClients(mapped);

        // Restore previously selected clients from localStorage
        const savedIds = persisted.selectedClientIds;
        if (savedIds?.length) {
          const restored = mapped.filter((c) => savedIds.includes(c.id) && c.routeReady);
          if (restored.length > 0) setSelectedClients(restored);
        }
      }
    };

    loadClients();
  }, []);

  const filteredClients = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm);
    const filtered = !normalizedSearch
      ? clients
      : clients.filter((client) =>
          [client.label, client.address, client.cidade, client.bairro, client.estado].some((field) =>
            normalizeText(field).includes(normalizedSearch)
          )
        );

    return [...filtered].sort(
      (a, b) => Number(b.routeReady) - Number(a.routeReady) || a.label.localeCompare(b.label, 'pt-BR')
    );
  }, [clients, searchTerm]);

  const toggleClient = (client: ClientOption) => {
    if (!client.routeReady) {
      toast.error(`Cadastro incompleto para ${client.label}: falta ${client.routeIssues.join(', ')}.`);
      return;
    }
    setSelectedClients((prev) => {
      const exists = prev.find((item) => item.id === client.id);
      if (exists) return prev.filter((item) => item.id !== client.id);
      return [...prev, client];
    });
  };

  const removeClient = (id: string) => {
    setSelectedClients((prev) => prev.filter((client) => client.id !== id));
  };

  const isValidCoord = (coord: [number, number]) => {
    const [lat, lng] = coord;
    return (
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -34 && lat <= 6 && lng >= -74 && lng <= -28
    );
  };

  const nominatimDelay = () => new Promise((r) => setTimeout(r, 350));

  const geocodeFreeText = async (query: string): Promise<[number, number] | null> => {
    try {
      const params = new URLSearchParams({
        format: 'json',
        countrycodes: 'br',
        limit: '1',
        addressdetails: '1',
        q: query,
      });

      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'Accept-Language': 'pt-BR' },
      });
      const data = await res.json();
      const result = Array.isArray(data) ? data[0] : null;
      if (!result) return null;

      const coord: [number, number] = [parseFloat(result.lat), parseFloat(result.lon)];
      return isValidCoord(coord) ? coord : null;
    } catch {
      return null;
    }
  };

  const geocodeClient = async (client: ClientOption): Promise<[number, number] | null> => {
    const fetchSearch = async (params: URLSearchParams) => {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { 'Accept-Language': 'pt-BR' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    };

    const runCandidate = async (
      params: URLSearchParams,
      target: { cidade: string; estado: string; bairro: string; cep: string }
    ) => {
      await nominatimDelay();
      const results = await fetchSearch(params);
      const bestMatch = pickBestGeocodeResult(results, target);
      if (!bestMatch) return null;
      const coord: [number, number] = [parseFloat(bestMatch.lat), parseFloat(bestMatch.lon)];
      return isValidCoord(coord) ? coord : null;
    };

    try {
      const cepLookup = await fetchCepLookup(client.cep);
      const streetNumber = extractStreetNumber(client.street);
      const currentStreet = buildStreetWithNumber(client.street, streetNumber);
      const canonicalStreet = buildStreetWithNumber(cepLookup?.street || '', streetNumber);
      const target = {
        cidade: cepLookup?.cidade || client.cidade,
        estado: cepLookup?.estado || client.estado,
        bairro: cepLookup?.bairro || client.bairro,
        cep: cepLookup?.cep || client.cep,
      };

      const seenStructured = new Set<string>();
      const structuredCandidates = [
        { street: currentStreet, city: client.cidade, state: client.estado, postalcode: normalizeDigits(client.cep) },
        { street: canonicalStreet, city: target.cidade, state: target.estado, postalcode: normalizeDigits(target.cep) },
        { street: currentStreet, city: target.cidade, state: target.estado, postalcode: normalizeDigits(target.cep) },
      ].filter((candidate) => {
        const key = JSON.stringify(candidate);
        if (!candidate.street || seenStructured.has(key)) return false;
        seenStructured.add(key);
        return true;
      });

      for (const candidate of structuredCandidates) {
        const params = new URLSearchParams({
          format: 'json',
          countrycodes: 'br',
          limit: '5',
          addressdetails: '1',
        });
        params.set('street', candidate.street);
        if (candidate.city) params.set('city', candidate.city);
        if (candidate.state) params.set('state', candidate.state);
        if (candidate.postalcode) params.set('postalcode', candidate.postalcode);

        const coords = await runCandidate(params, target);
        if (coords) return coords;
      }

      const textQueries = Array.from(new Set([
        [currentStreet, client.bairro, client.cidade, client.estado].filter(Boolean).join(', '),
        [currentStreet, client.cidade, client.estado].filter(Boolean).join(', '),
        [canonicalStreet, target.bairro, target.cidade, target.estado].filter(Boolean).join(', '),
        [canonicalStreet, target.cidade, target.estado].filter(Boolean).join(', '),
        [target.bairro, target.cidade, target.estado].filter(Boolean).join(', '),
        [normalizeDigits(target.cep), target.cidade, target.estado].filter(Boolean).join(', '),
        [target.cidade, target.estado].filter(Boolean).join(', '),
      ].filter(Boolean)));

      for (const query of textQueries) {
        const params = new URLSearchParams({
          format: 'json',
          countrycodes: 'br',
          limit: '5',
          addressdetails: '1',
          q: `${query}, Brasil`,
        });

        const coords = await runCandidate(params, target);
        if (coords) return coords;
      }

      return null;
    } catch {
      return null;
    }
  };

  const calculateRoute = async () => {
    if (selectedClients.length === 0) {
      toast.error('Selecione pelo menos uma loja.');
      return;
    }

    setRouteData(null);
    setRouteWarnings([]);
    setIsCalculating(true);

    try {
      const originCoords = await geocodeFreeText(origin);
      if (!originCoords) {
        throw new Error('Não foi possível localizar o endereço da fábrica.');
      }

      const geocodedClients = await Promise.all(
        selectedClients.map(async (client) => ({
          client,
          coords: await geocodeClient(client),
        }))
      );

      const unresolvedClients = geocodedClients.filter((item) => item.coords === null).map((item) => item.client.label);
      const resolvedClients = geocodedClients.filter(
        (item): item is { client: ClientOption; coords: [number, number] } => item.coords !== null
      );

      if (resolvedClients.length === 0) {
        throw new Error(`Não foi possível localizar nenhuma loja: ${unresolvedClients.join(', ')}.`);
      }

      if (unresolvedClients.length > 0) {
        setRouteWarnings([`Lojas ignoradas (geolocalização falhou): ${unresolvedClients.join(', ')}`]);
        toast.warning(`${unresolvedClients.length} ${unresolvedClients.length === 1 ? 'loja ignorada' : 'lojas ignoradas'} — rota gerada com as demais.`);
      }

      const allStops: RouteStop[] = [
        { label: 'Fábrica', coords: originCoords, kind: 'factory' },
        ...resolvedClients.map(({ client, coords }) => ({
          label: client.label,
          coords,
          kind: 'client' as const,
        })),
      ];

      const coordsStr = allStops.map((stop) => `${stop.coords[1]},${stop.coords[0]}`).join(';');
      const roundtrip = isOwnTransport;
      const url = `https://router.project-osrm.org/trip/v1/driving/${coordsStr}?source=first&roundtrip=${roundtrip}&overview=full&geometries=geojson&steps=false`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.code !== 'Ok' || !data.trips?.[0]) {
        const osrmMsg = data.message || data.code || 'desconhecido';
        throw new Error(`Erro no serviço de rotas (OSRM): ${osrmMsg}. Verifique os endereços.`);
      }

      const trip = data.trips[0];
      const waypoints: any[] = data.waypoints ?? [];

      if (waypoints.length !== allStops.length) {
        console.warn(`[Rota] OSRM retornou ${waypoints.length} waypoints para ${allStops.length} paradas`);
      }

      // Build ordered stops using waypoint_index (the optimized position in the trip)
      // waypoints[i] corresponds to allStops[i]; waypoint_index says where it goes in the result
      const orderedStops: RouteStop[] = new Array(waypoints.length);
      let indexingValid = true;

      for (let i = 0; i < waypoints.length; i++) {
        const wpIdx = waypoints[i]?.waypoint_index;
        if (typeof wpIdx !== 'number' || wpIdx < 0 || wpIdx >= waypoints.length) {
          indexingValid = false;
          break;
        }
        orderedStops[wpIdx] = allStops[i];
      }

      // Fallback: if waypoint_index is missing/invalid, sort by waypoint_index with tolerance
      if (!indexingValid) {
        console.warn('[Rota] waypoint_index inválido, usando ordem de entrada');
        orderedStops.length = 0;
        orderedStops.push(...allStops);
      }

      const legStops = roundtrip ? [...orderedStops, orderedStops[0]] : orderedStops;
      const legs: RouteLeg[] = (trip.legs ?? []).map((leg: any, index: number) => ({
        from: legStops[index]?.label || `Ponto ${index + 1}`,
        to: legStops[index + 1]?.label || `Ponto ${index + 2}`,
        distanceKm: leg.distance / 1000,
        durationMin: leg.duration / 60,
      }));

      const totalDistance = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
      const totalDuration = legs.reduce((sum, leg) => sum + leg.durationMin, 0);

      setRouteData({
        distance: totalDistance,
        duration: totalDuration,
        geometry: trip.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]] as [number, number]),
        optimizedOrder: orderedStops.filter((stop) => stop.kind === 'client').map((stop) => stop.label),
        orderedStops,
        legs,
        isRoundtrip: roundtrip,
      });

      toast.success('Rota otimizada com sucesso!');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao calcular. Verifique os endereços cadastrados.';
      setRouteWarnings([]);
      toast.error(message);
    } finally {
      setIsCalculating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Navigation className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>Logística Inteligente</CardTitle>
            <CardDescription>Selecione as lojas com entrega pendente para traçar a melhor rota</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Truck className="h-3.5 w-3.5" /> Saída da Fábrica
              </Label>
              <Input value={origin} onChange={(event) => setOrigin(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Custo Combustível (R$/km)</Label>
              <Input value={costPerKm} onChange={(event) => setCostPerKm(event.target.value)} type="number" step="0.01" />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <RotateCcw className="h-3.5 w-3.5" /> Transporte Próprio
                </Label>
                <p className="text-xs text-muted-foreground">
                  {isOwnTransport ? 'Inclui retorno à fábrica na rota' : 'Rota termina na última loja'}
                </p>
              </div>
              <Switch checked={isOwnTransport} onCheckedChange={setIsOwnTransport} />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Store className="h-3.5 w-3.5" /> Lojas Destino
              </Label>
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-muted-foreground font-normal">
                    <Search className="h-4 w-4 mr-2 shrink-0" />
                    {selectedClients.length > 0
                      ? `${selectedClients.length} ${selectedClients.length === 1 ? 'loja selecionada' : 'lojas selecionadas'}`
                      : 'Buscar por nome, bairro, cidade...'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Ex: Niterói, Centro, Nome da loja..."
                      value={searchTerm}
                      onValueChange={setSearchTerm}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhuma loja encontrada.</CommandEmpty>
                      <CommandGroup heading={`${filteredClients.length} lojas`}>
                        {filteredClients.map((client) => {
                          const isSelected = selectedClients.some((item) => item.id === client.id);

                          return (
                            <CommandItem
                              key={client.id}
                              value={client.id}
                              onSelect={() => toggleClient(client)}
                              className={cn('flex items-start gap-2', !client.routeReady && 'opacity-60')}
                            >
                              <Check className={cn('h-4 w-4 mt-0.5 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{client.label}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[client.cidade, client.estado].filter(Boolean).join(' - ') || 'Cidade/UF pendente'}
                                </p>
                                <p className="text-xs text-muted-foreground truncate" title={client.street || client.address || 'Endereço pendente'}>{client.street || client.address || 'Endereço pendente'}</p>
                                {!client.routeReady && (
                                  <p className="text-xs text-destructive truncate flex items-center gap-1 mt-0.5">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    Falta: {client.routeIssues.join(', ')}
                                  </p>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Popover open={orderPopoverOpen} onOpenChange={(open) => {
                setOrderPopoverOpen(open);
                if (open && orderClients.length === 0 && blockedOrderClients.length === 0 && unresolvedOrders.length === 0) loadOrderClients();
              }}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-muted-foreground font-normal gap-2">
                    <ClipboardList className="h-4 w-4 shrink-0" />
                    Buscar em Pedidos em Produção
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[340px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandList>
                      {loadingOrders ? (
                        <div className="flex items-center justify-center py-6">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="text-sm text-muted-foreground">Carregando pedidos...</span>
                        </div>
                      ) : orderClients.length === 0 ? (
                        <CommandEmpty>
                          {blockedOrderClients.length > 0 || unresolvedOrders.length > 0
                            ? 'Há pedidos, mas nenhuma loja com cadastro completo.'
                            : 'Nenhuma loja com pedidos em produção.'}
                        </CommandEmpty>
                      ) : (
                        <CommandGroup heading={`${orderClients.length} lojas com pedidos`}>
                          {orderClients.map((client) => {
                            const isSelected = selectedClients.some((item) => item.id === client.id);
                            return (
                              <CommandItem
                                key={client.id}
                                value={client.id}
                                onSelect={() => toggleClient(client)}
                                className="flex items-start gap-2"
                              >
                                <Check className={cn('h-4 w-4 mt-0.5 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{client.label}</p>
                                  <p className="text-xs text-muted-foreground truncate">
                                    {[client.cidade, client.estado].filter(Boolean).join(' - ')}
                                  </p>
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                  {(blockedOrderClients.length > 0 || unresolvedOrders.length > 0) && (
                    <div className="border-t px-3 py-2 space-y-1 text-xs bg-muted/30">
                      {blockedOrderClients.length > 0 && (
                        <div>
                          <p className="font-medium text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {blockedOrderClients.length} {blockedOrderClients.length === 1 ? 'loja com cadastro incompleto' : 'lojas com cadastro incompleto'}
                          </p>
                          {blockedOrderClients.slice(0, 3).map((c) => (
                            <p key={c.id} className="text-muted-foreground truncate ml-4">
                              {c.label} — falta: {c.routeIssues.join(', ')}
                            </p>
                          ))}
                        </div>
                      )}
                      {unresolvedOrders.length > 0 && (
                        <div>
                          <p className="font-medium text-destructive flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {unresolvedOrders.length} {unresolvedOrders.length === 1 ? 'pedido sem loja vinculada' : 'pedidos sem loja vinculada'}
                          </p>
                          {unresolvedOrders.slice(0, 3).map((label) => (
                            <p key={label} className="text-muted-foreground truncate ml-4">{label}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </PopoverContent>
              </Popover>

              <div className="space-y-1 max-h-48 overflow-y-auto">
                {selectedClients.map((client, index) => (
                  <div key={client.id} className="flex items-center justify-between bg-muted/50 rounded px-2 py-1.5 text-sm gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="secondary" className="shrink-0 h-5 w-5 p-0 flex items-center justify-center text-xs">
                        {index + 1}
                      </Badge>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{client.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{client.address}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-destructive"
                      onClick={() => removeClient(client.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button className="flex-1" onClick={calculateRoute} disabled={isCalculating}>
                {isCalculating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Navigation className="h-4 w-4 mr-2" />}
                Otimizar Sequência
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setOrigin('Rio de Janeiro, RJ');
                  setCostPerKm('1.50');
                  setIsOwnTransport(true);
                  setSelectedClients([]);
                  setRouteData(null);
                  setRouteWarnings([]);
                  setOrderClients([]);
                  setBlockedOrderClients([]);
                  setUnresolvedOrders([]);
                  localStorage.removeItem(ROUTE_STORAGE_KEY);
                  toast.info('Dados da rota limpos.');
                }}
              >
                <Eraser className="h-4 w-4 mr-2" />
                Limpar
              </Button>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            {routeWarnings.length > 0 && (
              <div className="rounded-lg border border-dashed p-3 space-y-1">
                {routeWarnings.map((w) => (
                  <p key={w} className="text-sm text-muted-foreground flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
                    {w}
                  </p>
                ))}
              </div>
            )}
            {routeData && (
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Distância Total</p>
                  <p className="text-lg font-bold text-primary">{routeData.distance.toFixed(1)} km</p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Combustível</p>
                  <p className="text-lg font-bold text-primary">
                    R$ {(routeData.distance * parseFloat(costPerKm || '0')).toFixed(2)}
                  </p>
                </Card>
                <Card className="p-3 text-center">
                  <p className="text-xs text-muted-foreground">Tempo Estimado</p>
                  <p className="text-lg font-bold text-primary">
                    {routeData.duration >= 60
                      ? `${Math.floor(routeData.duration / 60)}h${routeData.duration % 60 >= 1 ? ` ${Math.round(routeData.duration % 60)}min` : ''}`
                      : `${Math.round(routeData.duration)} min`}
                  </p>
                </Card>
              </div>
            )}

            <div className="rounded-lg overflow-hidden border" style={{ height: 400 }}>
              <LeafletMap routeData={routeData} />
            </div>

            {routeData && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    Sequência de Entrega {routeData.isRoundtrip ? '(ida e volta)' : '(somente ida)'}:
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="bg-primary/10">🏭 Fábrica</Badge>
                    {routeData.optimizedOrder.map((location, index) => (
                      <span key={location} className="flex items-center gap-1">
                        <span className="text-muted-foreground">→</span>
                        <Badge>{index + 1}. {location}</Badge>
                      </span>
                    ))}
                    {routeData.isRoundtrip && (
                      <>
                        <span className="text-muted-foreground">→</span>
                        <Badge variant="outline" className="bg-primary/10">🏭 Retorno Fábrica</Badge>
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Trechos calculados:</p>
                  <div className="space-y-2">
                    {routeData.legs.map((leg, index) => (
                      <div key={`${leg.from}-${leg.to}-${index}`} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm gap-3">
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {index + 1}. {leg.from} → {leg.to}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {leg.durationMin >= 60
                              ? `~${Math.floor(leg.durationMin / 60)}h${leg.durationMin % 60 >= 1 ? ` ${Math.round(leg.durationMin % 60)}min` : ''}`
                              : `~${Math.round(leg.durationMin)} min`}
                          </p>
                        </div>
                        <Badge variant="secondary">{leg.distanceKm.toFixed(1)} km</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
