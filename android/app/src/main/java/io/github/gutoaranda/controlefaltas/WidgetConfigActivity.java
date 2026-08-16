package io.github.gutoaranda.controlefaltas;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** Configuração do widget: o aluno cola o código copiado no app (Menu → Widget do celular). */
public class WidgetConfigActivity extends Activity {

    @Override
    protected void onCreate(Bundle salvo) {
        super.onCreate(salvo);
        setResult(RESULT_CANCELED);

        int widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,
                AppWidgetManager.INVALID_APPWIDGET_ID);

        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        raiz.setPadding(pad, pad, pad, pad);

        TextView titulo = new TextView(this);
        titulo.setText("Widget do Faltaê");
        titulo.setTextSize(20);
        titulo.setTextColor(Color.parseColor("#14172B"));
        raiz.addView(titulo);

        TextView instrucao = new TextView(this);
        instrucao.setText("\n1. Abra o Faltaê → Menu → Widget do celular\n2. Toque em \"Copiar código do widget\"\n3. Cole aqui embaixo\n\nRecurso do plano Essencial.");
        instrucao.setTextSize(14);
        raiz.addView(instrucao);

        EditText campo = new EditText(this);
        campo.setHint("cole o código aqui");
        campo.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        raiz.addView(campo, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button salvar = new Button(this);
        salvar.setText("Salvar e ativar");
        raiz.addView(salvar);

        setContentView(raiz);

        salvar.setOnClickListener(v -> {
            String texto = campo.getText().toString().trim();
            if (texto.contains("token=")) texto = texto.substring(texto.indexOf("token=") + 6).trim();
            if (texto.length() < 32) {
                Toast.makeText(this, "Código inválido — copie de novo no app.", Toast.LENGTH_LONG).show();
                return;
            }
            getSharedPreferences(SequenciaWidget.PREFS, Context.MODE_PRIVATE)
                    .edit().putString(SequenciaWidget.CHAVE_TOKEN, texto).apply();
            SequenciaWidget.atualizarAgora(this);
            Intent resultado = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
            setResult(RESULT_OK, resultado);
            Toast.makeText(this, "Widget ativado! 🔥", Toast.LENGTH_SHORT).show();
            finish();
        });
    }
}
