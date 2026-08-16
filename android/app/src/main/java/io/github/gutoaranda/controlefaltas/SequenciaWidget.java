package io.github.gutoaranda.controlefaltas;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;

/**
 * Widget da sequência. Sem código e sem configuração: o widget gera um
 * identificador aleatório e, ao ser tocado, abre o app — que conecta o
 * aparelho à conta sozinho. Estados vindos do servidor:
 *   desconectado → "toque para conectar" (abre o app com ?widget=ID)
 *   sem_acesso   → conectado, plano grátis → convite pro Essencial
 *   ok           → 🔥 sequência, 🏆 total e os dias seg–sex
 */
public class SequenciaWidget extends AppWidgetProvider {

    static final String PREFS = "widget";
    static final String CHAVE_DEVICE = "device_id";
    static final String CHAVE_CACHE = "cache";
    static final String URL_DADOS = "https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/widget?device=";
    static final String URL_APP = "https://gutoaranda.github.io/controle-faltas/";

    static final int[] CHIPS = { R.id.chip1, R.id.chip2, R.id.chip3, R.id.chip4, R.id.chip5 };
    static final int[] ROTULOS = { R.id.rot1, R.id.rot2, R.id.rot3, R.id.rot4, R.id.rot5 };

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        final PendingResult pendente = goAsync();
        new Thread(() -> {
            try {
                atualizarTodos(ctx, mgr, ids);
            } finally {
                pendente.finish();
            }
        }).start();
    }

    static String deviceId(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(CHAVE_DEVICE, "");
        if (id.isEmpty()) {
            SecureRandom r = new SecureRandom();
            StringBuilder sb = new StringBuilder(64);
            String alfabeto = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
            for (int i = 0; i < 64; i++) sb.append(alfabeto.charAt(r.nextInt(alfabeto.length())));
            id = sb.toString();
            prefs.edit().putString(CHAVE_DEVICE, id).apply();
        }
        return id;
    }

    static void atualizarTodos(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String device = deviceId(ctx);
        JSONObject dados = buscar(device);
        if (dados != null && "ok".equals(dados.optString("estado"))) {
            prefs.edit().putString(CHAVE_CACHE, dados.toString()).apply();
        }
        if (dados == null) { // sem rede: usa o último dado bom
            String cache = prefs.getString(CHAVE_CACHE, "");
            try { if (!cache.isEmpty()) dados = new JSONObject(cache); } catch (Exception ignorada) { }
        }
        for (int id : ids) mgr.updateAppWidget(id, montar(ctx, dados, device));
    }

    static JSONObject buscar(String device) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(URL_DADOS + device).openConnection();
            con.setConnectTimeout(10000);
            con.setReadTimeout(10000);
            if (con.getResponseCode() != 200) return null;
            BufferedReader r = new BufferedReader(new InputStreamReader(con.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String linha;
            while ((linha = r.readLine()) != null) sb.append(linha);
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            return null;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    static RemoteViews montar(Context ctx, JSONObject dados, String device) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_sequencia);

        // toque no corpo: abre o app já com o identificador (conexão automática)
        Intent abrir = new Intent(Intent.ACTION_VIEW, Uri.parse(URL_APP + "?widget=" + device));
        abrir.setPackage(ctx.getPackageName());
        rv.setOnClickPendingIntent(R.id.widget_raiz,
                PendingIntent.getActivity(ctx, 0, abrir, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        // botão ↻: força uma atualização do widget
        Intent atualizar = new Intent(ctx, SequenciaWidget.class);
        atualizar.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        atualizar.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS,
                AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, SequenciaWidget.class)));
        rv.setOnClickPendingIntent(R.id.atualizar,
                PendingIntent.getBroadcast(ctx, 2, atualizar, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        String estado = dados == null ? "offline" : dados.optString("estado", "desconectado");

        if ("ok".equals(estado)) {
            try {
                int sequencia = dados.optInt("sequencia", 0);
                int total = dados.optInt("total", 0);
                rv.setTextViewText(R.id.fogo, "🔥 " + sequencia + (sequencia == 1 ? " semana seguida" : " semanas seguidas"));
                rv.setTextViewText(R.id.trofeu, "🏆 " + total + " no semestre");
                rv.setTextViewText(R.id.msg, dados.optString("mensagem", ""));
                JSONArray dias = dados.getJSONArray("dias");
                for (int i = 0; i < 5 && i < dias.length(); i++) {
                    JSONObject d = dias.getJSONObject(i);
                    rv.setTextViewText(ROTULOS[i], d.optString("rotulo", ""));
                    switch (d.optString("estado", "livre")) {
                        case "presente":
                            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_presente);
                            rv.setTextViewText(CHIPS[i], "✓");
                            rv.setTextColor(CHIPS[i], Color.parseColor("#14172B"));
                            break;
                        case "falta":
                            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_falta);
                            rv.setTextViewText(CHIPS[i], "✕");
                            rv.setTextColor(CHIPS[i], Color.parseColor("#FB7185"));
                            break;
                        case "hoje":
                            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_hoje);
                            rv.setTextViewText(CHIPS[i], "hoje");
                            rv.setTextColor(CHIPS[i], Color.parseColor("#8B9BEC"));
                            break;
                        case "futuro":
                            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_futuro);
                            rv.setTextViewText(CHIPS[i], "");
                            break;
                        default:
                            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_livre);
                            rv.setTextViewText(CHIPS[i], "");
                    }
                }
                return rv;
            } catch (Exception e) {
                estado = "offline";
            }
        }

        zerarDias(rv);
        rv.setTextViewText(R.id.fogo, "Faltaê");
        rv.setTextViewText(R.id.trofeu, "");
        if ("sem_acesso".equals(estado)) {
            rv.setTextViewText(R.id.msg, "Recurso do Essencial — assine no app (R$ 15/mês)");
        } else if ("desconectado".equals(estado)) {
            rv.setTextViewText(R.id.msg, "Toque para conectar à sua conta");
        } else {
            rv.setTextViewText(R.id.msg, "Sem conexão — toque em ↻ pra tentar de novo");
        }
        return rv;
    }

    static void zerarDias(RemoteViews rv) {
        String[] nomes = { "seg", "ter", "qua", "qui", "sex" };
        for (int i = 0; i < 5; i++) {
            rv.setInt(CHIPS[i], "setBackgroundResource", R.drawable.chip_livre);
            rv.setTextViewText(CHIPS[i], "");
            rv.setTextViewText(ROTULOS[i], nomes[i]);
        }
    }
}
