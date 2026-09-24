// SEND-PUSH — Edge Function do Supabase
// Envia notificação push ("🎉 Nova venda!") pro celular/computador do
// vendedor, mesmo com o site fechado.
//
// Dois jeitos de chamar:
//  1) Pelo banco, a cada pedido (create_order → notify_order_push), com o
//     cabeçalho secreto x-hook-secret. Corpo: { "order_id": "..." }
//  2) Pelo próprio vendedor logado, pra testar ("Enviar teste"), com o
//     token de login no Authorization. Corpo: { "test": true }

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: cfg, error: cfgErr } = await admin.from("push_config").select("*").eq("id", 1).single();
  if (cfgErr || !cfg) return json({ error: "push_not_configured" }, 500);

  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corpo vazio */ }

  // Mensagens a enviar: { userId -> payload }
  const messages = new Map<string, Record<string, unknown>>();

  if (req.headers.get("x-hook-secret") === cfg.hook_secret && body.order_id) {
    // ── Modo 1: pedido novo ─────────────────────────────────────────
    const orderId = String(body.order_id);
    const { data: order } = await admin
      .from("orders").select("id, payment_method").eq("id", orderId).maybeSingle();
    if (!order) return json({ error: "order_not_found" }, 404);

    const { data: items } = await admin
      .from("order_items")
      .select("quantity, unit_price, products!product_id(name, owner_id)")
      .eq("order_id", orderId);

    const byVendor = new Map<string, { lines: string[]; total: number; units: number }>();
    for (const it of items || []) {
      // deno-lint-ignore no-explicit-any
      const p: any = (it as any).products;
      if (!p?.owner_id) continue;
      const g = byVendor.get(p.owner_id) || { lines: [], total: 0, units: 0 };
      const qty = Number(it.quantity) || 1;
      g.lines.push(`${qty > 1 ? qty + "x " : ""}${p.name}`);
      g.total += (Number(it.unit_price) || 0) * qty;
      g.units += qty;
      byVendor.set(p.owner_id, g);
    }

    const code = orderId.slice(0, 8).toUpperCase();
    const pay = order.payment_method === "Dinheiro" ? "dinheiro na entrega" : String(order.payment_method || "");
    for (const [vendorId, g] of byVendor) {
      const itemsText = g.lines.length > 2 ? `${g.lines.slice(0, 2).join(", ")} e mais ${g.lines.length - 2}` : g.lines.join(", ");
      messages.set(vendorId, {
        title: `🎉 Nova venda! R$ ${brl(g.total)}`,
        body: `${itemsText} · ${pay}${order.payment_method === "Pix" ? " — confira o comprovante no BI" : ""}`,
        tag: `order-${orderId}`,
        url: "./index.html#vendas",
        order: code,
      });
    }
  } else {
    // ── Modo 2: teste pelo próprio vendedor logado ──────────────────
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token || !body.test) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    messages.set(userData.user.id, {
      title: "🔔 Avisos de venda ativados!",
      body: "É assim que você vai saber na hora quando alguém comprar um produto seu.",
      tag: "push-test",
      url: "./index.html#vendas",
    });
  }

  if (!messages.size) return json({ sent: 0, reason: "no_recipients" });

  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", [...messages.keys()]);

  let sent = 0;
  const dead: string[] = [];
  const used: string[] = [];

  await Promise.all((subs as Sub[] || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(messages.get(s.user_id)),
        { TTL: 60 * 60 * 6, urgency: "high" },
      );
      sent++;
      used.push(s.id);
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) dead.push(s.id); // aparelho desinscrito/expirado
      else console.error("push falhou", code, (err as Error)?.message);
    }
  }));

  if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);
  if (used.length) await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", used);

  return json({ sent, removed: dead.length, recipients: messages.size, devices: subs?.length || 0 });
});
