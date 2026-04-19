import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VitalSignsInput {
  heartRate: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  arrhythmiaCount: number;
  glucose?: number;
  hemoglobin?: number;
  totalCholesterol?: number;
  triglycerides?: number;
  quality: number;
  confidence?: string;
  outputStates?: {
    spo2?: string;
    bp?: string;
    glucose?: string;
    lipids?: string;
  };
}

function validateInput(data: unknown): { valid: boolean; error?: string; parsed?: VitalSignsInput } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "Missing request body" };
  }

  const d = data as Record<string, unknown>;

  const heartRate = Number(d.heartRate);
  const spo2 = Number(d.spo2);
  const systolic = Number(d.systolic);
  const diastolic = Number(d.diastolic);

  if (!heartRate || heartRate < 20 || heartRate > 300) {
    return { valid: false, error: "heartRate must be between 20 and 300" };
  }
  if (!spo2 || spo2 < 50 || spo2 > 100) {
    return { valid: false, error: "spo2 must be between 50 and 100" };
  }
  if (!systolic || systolic < 50 || systolic > 300) {
    return { valid: false, error: "systolic must be between 50 and 300" };
  }
  if (!diastolic || diastolic < 30 || diastolic > 200) {
    return { valid: false, error: "diastolic must be between 30 and 200" };
  }

  return {
    valid: true,
    parsed: {
      heartRate,
      spo2,
      systolic,
      diastolic,
      arrhythmiaCount: Number(d.arrhythmiaCount) || 0,
      glucose: d.glucose ? Number(d.glucose) : undefined,
      hemoglobin: d.hemoglobin ? Number(d.hemoglobin) : undefined,
      totalCholesterol: d.totalCholesterol ? Number(d.totalCholesterol) : undefined,
      triglycerides: d.triglycerides ? Number(d.triglycerides) : undefined,
      quality: Number(d.quality) || 0,
      confidence: typeof d.confidence === "string" ? d.confidence : undefined,
      outputStates: typeof d.outputStates === "object" && d.outputStates
        ? {
            spo2: typeof (d.outputStates as Record<string, unknown>).spo2 === "string" ? (d.outputStates as Record<string, string>).spo2 : undefined,
            bp: typeof (d.outputStates as Record<string, unknown>).bp === "string" ? (d.outputStates as Record<string, string>).bp : undefined,
            glucose: typeof (d.outputStates as Record<string, unknown>).glucose === "string" ? (d.outputStates as Record<string, string>).glucose : undefined,
            lipids: typeof (d.outputStates as Record<string, unknown>).lipids === "string" ? (d.outputStates as Record<string, string>).lipids : undefined,
          }
        : undefined,
    },
  };
}

function buildPrompt(v: VitalSignsInput): string {
  let vitalsText = `
## Datos de Signos Vitales del Paciente

- **Frecuencia Cardíaca:** ${v.heartRate} BPM
- **SpO2 (Saturación de Oxígeno):** ${v.spo2}%
- **Presión Arterial:** ${v.systolic}/${v.diastolic} mmHg
- **Arritmias detectadas:** ${v.arrhythmiaCount}
- **Calidad de señal:** ${v.quality}%`;

  if (v.confidence) {
    vitalsText += `\n- **Confianza de medición:** ${v.confidence}`;
  }
  if (v.glucose && v.glucose > 0) {
    vitalsText += `\n- **Glucosa estimada:** ${v.glucose} mg/dL`;
  }
  if (v.hemoglobin && v.hemoglobin > 0) {
    vitalsText += `\n- **Hemoglobina estimada:** ${v.hemoglobin} g/dL`;
  }
  if (v.totalCholesterol && v.totalCholesterol > 0) {
    vitalsText += `\n- **Colesterol total estimado:** ${v.totalCholesterol} mg/dL`;
  }
  if (v.triglycerides && v.triglycerides > 0) {
    vitalsText += `\n- **Triglicéridos estimados:** ${v.triglycerides} mg/dL`;
  }

  return vitalsText;
}

const SYSTEM_PROMPT = `Eres un asistente médico experto en análisis de signos vitales obtenidos mediante fotopletismografía (PPG) por cámara de smartphone. Tu rol es analizar los datos proporcionados y ofrecer recomendaciones de salud personalizadas.

REGLAS IMPORTANTES:
1. Siempre indica que estos valores son ESTIMACIONES obtenidas por PPG de cámara, NO mediciones clínicas certificadas.
2. Ante cualquier valor anómalo, recomienda consultar un profesional médico.
3. Sé empático, claro y conciso.
4. Estructura tu respuesta en secciones claras.
5. Incluye un resumen general del estado de salud.
6. Responde SIEMPRE en español.
7. No uses terminología excesivamente técnica.
8. Si la calidad de señal es baja (<50%), advierte que los datos pueden no ser confiables.

FORMATO DE RESPUESTA (usa exactamente estas secciones con emojis):

🫀 **Resumen General**
(Breve evaluación del estado general)

📊 **Análisis Detallado**
(Análisis de cada signo vital con rangos normales de referencia)

⚠️ **Alertas** (solo si hay valores fuera de rango)
(Valores que requieren atención)

💡 **Recomendaciones**
(3-5 recomendaciones personalizadas basadas en los datos)

📋 **Nota Importante**
(Disclaimer sobre estimaciones PPG vs medición clínica)`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const validation = validateInput(body);

    if (!validation.valid || !validation.parsed) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const operationalSpo2 = validation.parsed.outputStates?.spo2 === 'ENABLED_HIGH_CONFIDENCE' || validation.parsed.outputStates?.spo2 === 'ENABLED_MEDIUM_CONFIDENCE';
    const operationalBP = validation.parsed.outputStates?.bp === 'ENABLED_HIGH_CONFIDENCE' || validation.parsed.outputStates?.bp === 'ENABLED_MEDIUM_CONFIDENCE';
    if (!operationalSpo2 || !operationalBP) {
      return new Response(
        JSON.stringify({ error: "SpO2 y presión arterial deben estar habilitadas por calidad/calibración para analizar." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vitalsPrompt = buildPrompt(validation.parsed);

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Analiza los siguientes signos vitales y proporciona recomendaciones de salud personalizadas:\n${vitalsPrompt}` },
        ],
        stream: false,
      }),
    });

    if (!aiResponse.ok) {
      const status = aiResponse.status;
      const errText = await aiResponse.text();
      console.error("AI gateway error:", status, errText);

      if (status === 429) {
        return new Response(
          JSON.stringify({ error: "Demasiadas solicitudes, intenta de nuevo en unos segundos." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (status === 402) {
        return new Response(
          JSON.stringify({ error: "Créditos de IA agotados." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "Error al procesar el análisis" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiData = await aiResponse.json();
    const analysis = aiData.choices?.[0]?.message?.content || "No se pudo generar el análisis.";

    return new Response(
      JSON.stringify({
        analysis,
        vitals: validation.parsed,
        analyzedAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("analyze-vitals error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
