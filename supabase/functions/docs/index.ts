// 옳은Docs API. One function, action-based JSON POST. Codes are the credential; the admin code lives in the ADMIN_CODE secret.
import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_CODE = Deno.env.get("ADMIN_CODE") ?? "";
const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUCKET = "materials";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => json({ ok: false, error: message }, status);
const normCode = (c: unknown) => String(c ?? "").replace(/\D/g, "").slice(0, 12);

async function resolveCode(code: string) {
  if (!code) return null;
  if (ADMIN_CODE && code === ADMIN_CODE) return { role: "admin" as const, id: null, label: "관리자" };
  const { data } = await supa.from("access_codes").select("id,label,active").eq("code", code).maybeSingle();
  if (!data || !data.active) return null;
  supa.from("access_codes").update({ last_used_at: new Date().toISOString() }).eq("id", data.id).then(() => {});
  return { role: "user" as const, id: data.id as string, label: data.label as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST only", 405);
  let body: any; try { body = await req.json(); } catch { return fail("invalid json"); }
  const action = String(body.action ?? ""); const code = normCode(body.code);
  const who = await resolveCode(code);
  supa.from("access_log").insert({ code: code.slice(0, 12), action, ok: !!who }).then(() => {});
  if (!who) return fail("유효하지 않은 코드입니다", 401);

  try {
    switch (action) {
      case "verify": return json({ ok: true, role: who.role, label: who.label });
      case "list": {
        if (who.role === "admin") { const { data } = await supa.from("materials").select("*").order("created_at", { ascending: false }); return json({ ok: true, materials: data ?? [] }); }
        const { data } = await supa.from("code_materials").select("material:materials(*)").eq("code_id", who.id);
        return json({ ok: true, materials: (data ?? []).map((r: any) => r.material).filter((m: any) => m && m.ready) });
      }
      case "download": {
        const id = String(body.materialId ?? "");
        if (who.role !== "admin") { const { data: ok } = await supa.from("code_materials").select("material_id").eq("code_id", who.id).eq("material_id", id).maybeSingle(); if (!ok) return fail("이 교재에 대한 권한이 없습니다", 403); }
        const { data: m } = await supa.from("materials").select("storage_path,title,file_name").eq("id", id).maybeSingle(); if (!m) return fail("교재를 찾을 수 없습니다", 404);
        const { data: s, error } = await supa.storage.from(BUCKET).createSignedUrl(m.storage_path, 600); if (error || !s) return fail("다운로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        return json({ ok: true, url: s.signedUrl, title: m.title, fileName: m.file_name });
      }
    }
    if (who.role !== "admin") return fail("관리자 전용 기능입니다", 403);
    switch (action) {
      case "codes.list": {
        const { data: codes } = await supa.from("access_codes").select("*").order("created_at", { ascending: false });
        const { data: links } = await supa.from("code_materials").select("code_id,material_id");
        return json({ ok: true, codes: codes ?? [], links: links ?? [] });
      }
      case "codes.create": {
        let c = normCode(body.newCode); if (!c) { do { c = String(Math.floor(100000 + Math.random() * 900000)); } while (c === ADMIN_CODE); }
        if (c === ADMIN_CODE) return fail("관리자 코드와 같은 코드는 만들 수 없습니다");
        const { data, error } = await supa.from("access_codes").insert({ code: c, label: String(body.label ?? "") }).select().single(); if (error) return fail(error.message.includes("duplicate") ? "이미 있는 코드입니다" : error.message);
        return json({ ok: true, code: data });
      }
      case "codes.update": { const patch: any = {}; if (typeof body.active === "boolean") patch.active = body.active; if (typeof body.label === "string") patch.label = body.label; const { data, error } = await supa.from("access_codes").update(patch).eq("id", String(body.id)).select().single(); if (error) return fail(error.message); return json({ ok: true, code: data }); }
      case "codes.delete": { const { error } = await supa.from("access_codes").delete().eq("id", String(body.id)); if (error) return fail(error.message); return json({ ok: true }); }
      case "assign": {
        const codeId = String(body.codeId), materialId = String(body.materialId);
        if (body.assigned) { const { error } = await supa.from("code_materials").upsert({ code_id: codeId, material_id: materialId }); if (error) return fail(error.message); }
        else { const { error } = await supa.from("code_materials").delete().eq("code_id", codeId).eq("material_id", materialId); if (error) return fail(error.message); }
        return json({ ok: true });
      }
      case "assign.bulk": { // set the full list of material ids for a code
        const codeId = String(body.codeId); const ids: string[] = Array.isArray(body.materialIds) ? body.materialIds.map(String) : [];
        await supa.from("code_materials").delete().eq("code_id", codeId);
        if (ids.length) { const { error } = await supa.from("code_materials").insert(ids.map((material_id) => ({ code_id: codeId, material_id }))); if (error) return fail(error.message); }
        return json({ ok: true });
      }
      case "materials.uploadUrl": {
        const title = String(body.title ?? "").trim() || "제목 없음"; const fileName = String(body.fileName ?? "file.pdf");
        const id = crypto.randomUUID(); const path = `${id}.pdf`;
        const { data: s, error } = await supa.storage.from(BUCKET).createSignedUploadUrl(path); if (error || !s) return fail("업로드 URL 생성 실패: " + (error?.message ?? ""), 500);
        const { error: e2 } = await supa.from("materials").insert({ id, title, file_name: fileName, storage_path: path, ready: false }); if (e2) return fail(e2.message);
        return json({ ok: true, materialId: id, path, uploadUrl: s.signedUrl, token: s.token });
      }
      case "materials.complete": { const { data, error } = await supa.from("materials").update({ ready: true, size: Number(body.size ?? 0), pages: Number(body.pages ?? 0) }).eq("id", String(body.materialId)).select().single(); if (error) return fail(error.message); return json({ ok: true, material: data }); }
      case "materials.rename": { const { data, error } = await supa.from("materials").update({ title: String(body.title ?? "") }).eq("id", String(body.id)).select().single(); if (error) return fail(error.message); return json({ ok: true, material: data }); }
      case "materials.delete": {
        const { data: m } = await supa.from("materials").select("storage_path").eq("id", String(body.id)).maybeSingle();
        if (m) await supa.storage.from(BUCKET).remove([m.storage_path]);
        const { error } = await supa.from("materials").delete().eq("id", String(body.id)); if (error) return fail(error.message); return json({ ok: true });
      }
      case "stats": { const [{ count: c }, { count: m }, { data: log }] = await Promise.all([supa.from("access_codes").select("*", { count: "exact", head: true }), supa.from("materials").select("*", { count: "exact", head: true }), supa.from("access_log").select("code,action,ok,at").order("at", { ascending: false }).limit(50)]); return json({ ok: true, codes: c ?? 0, materials: m ?? 0, log: log ?? [] }); }
    }
    return fail("unknown action " + action, 404);
  } catch (e) { return fail("server error: " + (e as Error).message, 500); }
});
