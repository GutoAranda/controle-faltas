package io.github.gutoaranda.controlefaltas;

import android.graphics.Color;

/** Widget da sequência — tema claro ("claro de papel"). */
public class SequenciaWidgetClaro extends SequenciaWidget {
    @Override int layout() { return R.layout.widget_sequencia_claro; }
    @Override int chipPresente() { return R.drawable.chip_presente; }
    @Override int chipFalta() { return R.drawable.chip_falta_claro; }
    @Override int chipHoje() { return R.drawable.chip_hoje_claro; }
    @Override int chipFuturo() { return R.drawable.chip_futuro_claro; }
    @Override int chipLivre() { return R.drawable.chip_livre_claro; }
    @Override int corPresente() { return Color.parseColor("#14172B"); }
    @Override int corFalta() { return Color.parseColor("#B31138"); }
    @Override int corHoje() { return Color.parseColor("#4056C7"); }
    @Override int corNeutra() { return Color.parseColor("#8A90AC"); }
}
