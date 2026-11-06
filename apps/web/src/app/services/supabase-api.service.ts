import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import type { DungeonsListQuery, StormFortsListQuery, StormIslesListQuery } from './api-rest.service';
import {
  ApiDungeonsByPlayerIdResponse,
  ApiDungeonsMetaResponse,
  ApiDungeonsResource,
  ApiDungeonsResponse,
  ApiLastUpdates,
  ApiPlayerProfile,
  ApiPlayerSuggestion,
  ApiStormFort,
  ApiStormFortsResponse,
  ApiStormIsle,
  ApiStormIslesResponse,
  ApiStormMetaResponse,
}

from '@ggetracker-interfaces/empire-ranking';

const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 8_000;
const MAX_PAGE_SIZE = 4000;
const DUNGEON_WORLD_WIDTH = 1287;
const STORM_MAX_VICTORIES = 10;

interface Pagination {
  current_page: number;
  current_items_count: number;
  total_pages: number;
  total_items_count: number;
}

@Injectable({ providedIn: 'root' })
export class SupabaseApiService {
  private readonly client: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  private readonly cache = new Map<string, { at: number; rows: any[] }>();

  private async rows(view: string, ttl = CACHE_TTL_MS): Promise<any[]> {
    const cached = this.cache.get(view);
    if (cached && Date.now() - cached.at < ttl) return cached.rows;
    const all: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client.from(view).select('*').range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`${view}: ${error.message}`);
      all.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    this.cache.set(view, { at: Date.now(), rows: all });
    return all;
  }

  private pagination(page: number, size: number, total: number, current: number): Pagination {
    return {
      current_page: page,
      current_items_count: current,
      total_pages: Math.max(1, Math.ceil(total / Math.max(1, size))),
      total_items_count: total,
    };
  }

  private pageSlice<T>(rows: T[], page: number, size: number): T[] {
    const perPage = size === 0 ? MAX_PAGE_SIZE : size || 15;
    const start = (Math.max(1, page) - 1) * perPage;
    return rows.slice(start, start + perPage);
  }

  private async origin(nearPlayerName?: string | null): Promise<{ x: number; y: number } | null> {
    if (!nearPlayerName) return null;
    const players = await this.rows('v_players');
    const wanted = nearPlayerName.trim().toLowerCase();
    const player = players.find((row) => String(row.name).toLowerCase() === wanted);
    const castles = Array.isArray(player?.castles) ? player.castles : [];
    const main = castles.find((castle: any[]) => Number(castle?.[2]) === 1) ?? castles[0];
    if (!main) return null;
    const x = Number(main[0]);
    const y = Number(main[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  private simpleDistance(row: any, origin: { x: number; y: number } | null): number | null {
    if (!origin) return null;
    const dx = Number(row.position_x) - origin.x;
    const dy = Number(row.position_y) - origin.y;
    return Number(Math.sqrt(dx * dx + dy * dy).toFixed(1));
  }

  private dungeonDistance(row: any, origin: { x: number; y: number } | null): number | null {
    if (!origin) return null;
    const dx = Math.abs(Number(row.position_x) - origin.x);
    const torus = Math.min(dx, DUNGEON_WORLD_WIDTH - dx);
    const dy = Number(row.position_y) - origin.y;
    return Number(Math.sqrt(torus * torus + dy * dy).toFixed(1));
  }

  public async stormForts(query: StormFortsListQuery): Promise<ApiStormFortsResponse> {
    const rows = (await this.rows('v_storm_forts')) as ApiStormFort[];
    const now = Date.now();
    const origin = await this.origin(query.nearPlayerName);
    const maxDistance = query.maxDistance ?? null;
    const minAttacks = query.minAttacksLeft ?? null;
    const availability = query.filterByAvailability === null ? null : String(query.filterByAvailability);
    const isleIds = query.filterByIsleIds ?? null;

    const filtered = rows.filter((row) => {
      if (isleIds !== null && !isleIds.includes(Number(row.isle_id))) return false;
      if (availability === '1' && !(row.is_visible && new Date(row.available_at).getTime() <= now && row.victory_count < STORM_MAX_VICTORIES)) return false;
      if (availability === '2' && !(new Date(row.available_at).getTime() > now && new Date(row.available_at).getTime() - now <= 300_000)) return false;
      if (availability === '3' && !(new Date(row.available_at).getTime() > now && new Date(row.available_at).getTime() - now <= 3_600_000)) return false;
      if (minAttacks !== null && Number(row.attacks_left) < minAttacks) return false;
      if (origin) {
        const distance = this.simpleDistance(row, origin);
        row.distance = distance;
        if (maxDistance !== null && (distance ?? 0) > maxDistance) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const direction = query.orderDirection === 'desc' ? -1 : 1;
      const actionable = (row: ApiStormFort) => Number(row.is_visible && new Date(row.available_at).getTime() <= now);
      if (origin && (!query.orderBy || query.orderBy === 'distance')) {
        return ((a.distance ?? 0) - (b.distance ?? 0)) * direction;
      }
      switch (query.orderBy) {
        case 'availability':
          return (new Date(a.available_at).getTime() - new Date(b.available_at).getTime()) * direction;
        case 'attacksLeft':
          return (a.victory_count - b.victory_count) * (query.orderDirection === 'desc' ? 1 : -1);
        case 'position':
          return (a.position_x - b.position_x || a.position_y - b.position_y) * direction;
        default:
          return (actionable(b) - actionable(a)) || (new Date(a.available_at).getTime() - new Date(b.available_at).getTime());
      }
    });

    const pageRows = this.pageSlice(sorted, query.page, query.size);
    return {
      duration: '0ms',
      pagination: this.pagination(query.page, query.size, sorted.length, pageRows.length),
      forts: pageRows,
    };
  }

  public async stormIsles(query: StormIslesListQuery): Promise<ApiStormIslesResponse> {
    const rows = (await this.rows('v_storm_isles')) as ApiStormIsle[];
    const origin = await this.origin(query.nearPlayerName);
    const maxDistance = query.maxDistance ?? null;
    const state = query.filterByState === null ? null : String(query.filterByState);
    const isleIds = query.filterByIsleIds ?? null;
    const occupier = query.filterByOccupierName?.trim().toLowerCase() ?? null;

    const filtered = rows.filter((row) => {
      if (isleIds !== null && !isleIds.includes(Number(row.isle_id))) return false;
      if (state !== null && String(row.state) !== state) return false;
      if (occupier && !String(row.occupier_name ?? '').toLowerCase().includes(occupier)) return false;
      if (origin) {
        const distance = this.simpleDistance(row, origin);
        row.distance = distance;
        if (maxDistance !== null && (distance ?? 0) > maxDistance) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const direction = query.orderDirection === 'desc' ? -1 : 1;
      if (origin && (!query.orderBy || query.orderBy === 'distance')) {
        return ((a.distance ?? 0) - (b.distance ?? 0)) * direction;
      }
      switch (query.orderBy) {
        case 'availability':
          return (new Date(a.available_at).getTime() - new Date(b.available_at).getTime()) * direction;
        case 'position':
          return (a.position_x - b.position_x || a.position_y - b.position_y) * direction;
        default:
          return (Number(b.state === 0) - Number(a.state === 0)) || (new Date(a.available_at).getTime() - new Date(b.available_at).getTime());
      }
    });

    const pageRows = this.pageSlice(sorted, query.page, query.size);
    return {
      duration: '0ms',
      pagination: this.pagination(query.page, query.size, sorted.length, pageRows.length),
      isles: pageRows,
    };
  }

  public async stormMeta(): Promise<ApiStormMetaResponse> {
    const rows = await this.rows('v_storm_meta');
    const row = rows[0] ?? {};
    return {
      season_started_at: row.season_started_at ?? null,
      scan_radius: Number(row.scan_radius) || 0,
      last_scan_at: row.last_scan_at ?? null,
      forts_count: Number(row.forts_count) || 0,
      isles_count: Number(row.isles_count) || 0,
    };
  }

  public async dungeons(query: DungeonsListQuery): Promise<ApiDungeonsResponse> {
    const rows = (await this.rows('v_dungeons')) as any[];
    const now = Date.now();
    const kids = (JSON.parse(query.filterByKid || '[2]') as unknown[]).map(Number);
    const cooldown = query.filterByAttackCooldown === null ? null : String(query.filterByAttackCooldown);
    const playerName = query.filterByPlayerName?.trim().toLowerCase() ?? null;
    const origin = await this.origin(query.nearPlayerName);

    const filtered = rows.filter((row) => {
      if (Array.isArray(kids) && kids.length > 0 && !kids.includes(Number(row.kid))) return false;
      const until = new Date(row.effective_cooldown_until).getTime();
      if (cooldown === '1' && !(until <= now)) return false;
      if (cooldown === '2' && !(until > now && until - now <= 300_000)) return false;
      if (cooldown === '3' && !(until > now && until - now <= 3_600_000)) return false;
      if (playerName && !String(row.player_name ?? '').toLowerCase().includes(playerName)) return false;
      if (origin) row.distance = this.dungeonDistance(row, origin);
      return true;
    });

    const mapped = filtered.map((row) => this.toDungeonResource(row));
    mapped.sort((a, b) => {
      const aActionable = new Date(a.effective_cooldown_until).getTime() <= now;
      const bActionable = new Date(b.effective_cooldown_until).getTime() <= now;
      if (origin) return (a.distance ?? 0) - (b.distance ?? 0);
      return (
        Number(bActionable) - Number(aActionable) ||
        new Date(a.effective_cooldown_until).getTime() - new Date(b.effective_cooldown_until).getTime() ||
        a.kid - b.kid ||
        a.position_x - b.position_x ||
        a.position_y - b.position_y
      );
    });

    const pageRows = this.pageSlice(mapped, query.page, query.size);
    return {
      duration: '0ms',
      pagination: this.pagination(query.page, query.size, mapped.length, pageRows.length),
      dungeons: pageRows,
    };
  }

  private toDungeonResource(row: any): ApiDungeonsResource {
    const last = row.last_attack ? new Date(row.last_attack).getTime() : null;
    const previous = row.previous_attack_at ? new Date(row.previous_attack_at).getTime() : null;
    const secondsBetween = last !== null && previous !== null ? (last - previous) / 1000 : null;
    const duration = secondsBetween === null ? 0 : Math.round(Math.max(secondsBetween - 86_400, 0));
    return {
      kid: Number(row.kid),
      position_x: Number(row.position_x),
      position_y: Number(row.position_y),
      player_id: row.player_id ? Number(row.player_id) : null,
      player_name: row.player_name ?? undefined,
      player_might: row.player_might ?? null,
      player_level: row.player_level ?? null,
      player_legendary_level: row.player_legendary_level ?? null,
      last_attack: row.last_attack,
      global_available_at: row.global_available_at,
      available_duration_seconds: duration,
      effective_cooldown_until: row.effective_cooldown_until,
      distance: row.distance ?? null,
    } as ApiDungeonsResource;
  }

  public async dungeonsMeta(): Promise<ApiDungeonsMetaResponse> {
    const rows = await this.rows('v_dungeons_meta', 2_000);
    return { last_scan_at: rows[0]?.last_scan_at ?? null };
  }

  public async dungeonsByPlayer(playerId: number): Promise<ApiDungeonsByPlayerIdResponse> {
    const raw = Number(String(playerId).replace(/212$/, ''));
    const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { data, error } = await this.client
      .from('v_dungeons_history')
      .select('kid,position_x,position_y,attacked_at')
      .eq('player_id', raw)
      .gte('attacked_at', since)
      .order('attacked_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    return {
      duration: '0ms',
      pagination: {
        current_page: 1,
        current_items_count: rows.length,
        total_pages: 1,
        total_items_count: rows.length,
      },
      dungeons: rows,
    };
  }

  public async lastUpdates(): Promise<ApiLastUpdates> {
    const now = new Date();
    const [storm, dungeons, playersCount, dungeonsCount] = await Promise.all([
      this.stormMeta().catch(() => ({ last_scan_at: null })),
      this.dungeonsMeta().catch(() => ({ last_scan_at: null })),
      this.client.from('v_players').select('*', { count: 'exact', head: true }),
      this.client.from('v_dungeons').select('*', { count: 'exact', head: true }),
    ]);
    const timestamps = [storm.last_scan_at, dungeons.last_scan_at]
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));
    const lastScan = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : now;
    const lastIso = lastScan.toISOString();
    const ageSeconds = Math.max(0, Math.floor((now.getTime() - lastScan.getTime()) / 1000));
    const eventDates = {
      berimond_invasion: lastIso,
      berimond_kingdom: lastIso,
      bloodcrow: lastIso,
      loot: lastIso,
      might: lastIso,
      nomad: lastIso,
      samurai: lastIso,
      war_realms: lastIso,
    };
    return {
      api_url: '',
      documentation_url: 'https://github.com/Synapse-VE/gge-storm-dungeons',
      discord_url: 'https://discord.gg/gge-tracker',
      discord_member_count: 0,
      release_version: '2026-11-02',
      website_url: 'https://synapse-ve.github.io/gge-storm-dungeons/',
      server: 'HIS1',
      server_code: '212',
      zone: 'EmpireEx_25',
      platform: 'EP',
      version: '26.11.02',
      generated_at: now.toISOString(),
      update_in_progress: false,
      last_update: eventDates,
      data: {
        version: 1,
        state: 'idle',
        age_seconds: ageSeconds,
        stale: false,
        last_fill_started_at: lastIso,
        last_fill_completed_at: lastIso,
        last_fill_duration_seconds: 0,
        fill_interval_seconds: 600,
        next_fill_estimated_at: null,
        next_data_estimated_at: null,
        steps: [],
      },
      dataset: {
        players: playersCount.count ?? null,
        alliances: null,
        snapshot_at: lastIso,
      },
      weekly_loot_reset: null,
      polling: {
        recommended_interval_seconds: 60,
        poll_after: null,
        cache_ttl_seconds: 60,
        etag: '',
        instructions: '',
      },
      rate_limit: { requests: 0, window_seconds: 60, applies_to_this_route: false },
    };
  }

  public async playerSuggestions(query: string): Promise<{ suggestions: ApiPlayerSuggestion[] }> {
    const search = (query ?? '').trim();
    if (!search) return { suggestions: [] };
    const { data, error } = await this.client
      .from('v_players')
      .select('id,name,might_current,level,legendary_level,alliance_name')
      .ilike('name', `%${search}%`)
      .order('might_current', { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return {
      suggestions: (data ?? []).map((row: any) => ({
        id: String(row.id),
        name: row.name,
        might_current: Number(row.might_current) || 0,
        level: Number(row.level) || 0,
        legendary_level: Number(row.legendary_level) || 0,
        alliance_name: row.alliance_name ?? null,
      })),
    };
  }

  public async playerProfile(playerId: string): Promise<ApiPlayerProfile> {
    const id = Number(String(playerId).replace(/212$/, ''));
    const { data, error } = await this.client
      .from('v_players')
      .select('id,name,alliance_id,alliance_name,might_current,level,legendary_level,current_fame,honor,castles')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Player not found');
    const castles = (Array.isArray(data.castles) ? data.castles : []).map((castle: any[]) => ({
      kingdom_id: 0,
      castle_type: Number(castle?.[2]) || 1,
      position_x: Number(castle?.[0]),
      position_y: Number(castle?.[1]),
    }));
    return {
      server: 'HIS1',
      server_code: '212',
      server_name: 'HIS1',
      player: {
        player_id: String(data.id),
        player_name: data.name,
        alliance_id: data.alliance_id ? String(data.alliance_id) : null,
        alliance_name: data.alliance_name ?? null,
        alliance_rank: null,
        might_current: Number(data.might_current) || 0,
        might_all_time: 0,
        loot_current: 0,
        loot_all_time: 0,
        honor: Number(data.honor) || 0,
        max_honor: 0,
        highest_fame: 0,
        current_fame: Number(data.current_fame) || 0,
        level: Number(data.level) || 0,
        legendary_level: Number(data.legendary_level) || 0,
      },
      castles,
    } as unknown as ApiPlayerProfile;
  }
}
