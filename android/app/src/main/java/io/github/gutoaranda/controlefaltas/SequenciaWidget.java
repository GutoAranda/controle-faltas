package io.github.gutoaranda.controlefaltas;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/** Widget da sequência: 🔥 semanas seguidas, 🏆 total do semestre e os dias seg–sex. */
public class SequenciaWidget extends AppWidgetProvider {

    static final String PREFS = "widget";
    static final String CHAVE_TOKEN = "token";
    static final String CHAVE_CACHE = "cache";
    static final String URL_DADOS = "https://ejdvolbpqrvtuemunzto.supabase.co/functions/v1/widget?token=";

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

    static void atualizarTodos(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String token = prefs.getString(CHAVE_TOKEN, "");
        JSONObject dados = null;
        if (token.length() >= 32) {
            dados = buscar(token);
            if (dados != null) prefs.edit().putString(CHAVE_CACHE, dados.toString()).apply();
            else {
                String cache = prefs.getString(CHAVE_CACHE, "");
                try { if (!cache.isEmpty()) dados = new JSONObject(cache); } catch (Exception ignorada) { }
            }
        }
        for (int id : ids) mgr.updateAppWidget(id, montar(ctx, dados, token));
    }

    static JSONObject buscar(String token) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(URL_DADOS + token).openConnection();
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

    static RemoteViews montar(Context ctx, JSONObject dados, String token) {
        RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_sequencia);

        Intent abrirApp = new Intent(ctx, com.google.androidbrowserhelper.trusted.LauncherActivity.class);
        rv.setOnClickPendingIntent(R.id.widget_raiz,
                PendingIntent.getActivity(ctx, 0, abrirApp, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        if (token.length() < 32) {
            Intent config = new Intent(ctx, WidgetConfigActivity.class);
            rv.setOnClickPendingIntent(R.id.widget_raiz,
                    PendingIntent.getActivity(ctx, 1, config, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            rv.setTextViewText(R.id.fogo, "Faltaê");
            rv.setTextViewText(R.id.trofeu, "");
            rv.setTextViewText(R.id.msg, "Toque para configurar o widget");
            zerarDias(rv);
            return rv;
        }
        if (dados == null) {
            rv.setTextViewText(R.id.fogo, "Faltaê");
            rv.setTextViewText(R.id.trofeu, "");
            rv.setTextViewText(R.id.msg, "Sem conexão — toque para abrir o app");
            zerarDias(rv);
            return rv;
        }

        try {
            int sequencia = dados.optInt("sequencia", 0);
            int total = dados.optInt("total", 0);
            rv.setTextViewText(R.id.fogo, "🔥 " + sequencia + (sequencia == 1 ? " semana seguida" : " semanas seguidas"));
            rv.setTextViewText(R.id.trofeu, "🏆 " + total + " no semestre");
            rv.setTextViewText(R.id.msg, dados.optString("mensagem", ""));

            JSONArray dias = dados.getJSONArray("dias");
            for (int i = 0; i < 5 && i < dias.length(); i++) {
                JSONObject d = dias.getJSONObject(i);
                String estado = d.optString("estado", "livre");
                rv.setTextViewText(ROTULOS[i], d.optString("rotulo", ""));
                switch (estado) {
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
        } catch (Exception e) {
            rv.setTextViewText(R.id.msg, "Abra o Faltaê para sincronizar");
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

    /** Chamado pela tela de configuração pra atualizar na hora. */
    static void atualizarAgora(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, SequenciaWidget.class));
        new Thread(() -> atualizarTodos(ctx, mgr, ids)).start();
    }
}
