const CLINPGX_BASE_URL = "https://api.clinpgx.org/v1/data";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método no permitido.",
      allowedMethod: "GET"
    });
  }

  const drug = String(req.query.drug || "").trim();
  const gene = String(req.query.gene || "").trim();
  const variant = String(req.query.variant || "").trim();

  if (!drug) {
    return res.status(400).json({
      error: "Debe indicar el nombre del medicamento.",
      example: "/api/clinpgx?drug=codeine&gene=CYP2D6"
    });
  }

  try {
    const commonParams = {
      "relatedChemicals.name": drug,
      view: "max"
    };

    /*
      La consulta clínica ya fue probada previamente
      con location.genes.symbol.
    */
    const clinicalParams = {
      ...commonParams
    };

    if (gene) {
      clinicalParams["location.genes.symbol"] = gene;
    }

    /*
      Para guías y etiquetas consultamos inicialmente
      por medicamento. Luego el frontend puede mostrar
      y filtrar la información relacionada con el gen.
    */
    const guidelineParams = {
      ...commonParams
    };

    const labelParams = {
      ...commonParams
    };

    const variantParams = {
      ...commonParams
    };

    if (variant) {
      variantParams["variant.name"] = variant;
    }

    const [
      clinicalAnnotations,
      guidelineAnnotations,
      labelAnnotations,
      variantAnnotations
    ] = await Promise.all([
      consultarClinPGxEndpoint({
        endpoint: "clinicalAnnotation",
        params: clinicalParams
      }),

      consultarClinPGxEndpoint({
        endpoint: "guidelineAnnotation",
        params: guidelineParams
      }),

      /*
        En la API histórica de PharmGKB/ClinPGx,
        las etiquetas se consultan como labelAnnotation.
      */
      consultarClinPGxEndpoint({
        endpoint: "labelAnnotation",
        params: labelParams,
        fallbackEndpoints: ["label"]
      }),

      consultarClinPGxEndpoint({
        endpoint: "variantAnnotation",
        params: variantParams
      })
    ]);

    return res.status(200).json({
      source: "ClinPGx",
      requestedAt: new Date().toISOString(),

      query: {
        drug,
        gene: gene || null,
        variant: variant || null
      },

      summary: {
        clinicalAnnotations:
          contarRegistros(clinicalAnnotations.data),

        guidelineAnnotations:
          contarRegistros(guidelineAnnotations.data),

        labelAnnotations:
          contarRegistros(labelAnnotations.data),

        variantAnnotations:
          contarRegistros(variantAnnotations.data)
      },

      results: {
        clinicalAnnotations,
        guidelineAnnotations,
        labelAnnotations,
        variantAnnotations
      },

      warnings: crearAdvertencias({
        clinicalAnnotations,
        guidelineAnnotations,
        labelAnnotations,
        variantAnnotations
      })
    });

  } catch (error) {
    return res.status(500).json({
      error: "No fue posible completar la consulta a ClinPGx.",
      detail:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}

async function consultarClinPGxEndpoint({
  endpoint,
  params,
  fallbackEndpoints = []
}) {
  const endpoints = [
    endpoint,
    ...fallbackEndpoints
  ];

  const intentos = [];

  for (const endpointActual of endpoints) {
    const resultado = await ejecutarConsulta({
      endpoint: endpointActual,
      params
    });

    intentos.push({
      endpoint: endpointActual,
      status: resultado.status,
      ok: resultado.ok
    });

    if (resultado.ok) {
      return {
        ok: true,
        endpoint: endpointActual,
        status: resultado.status,
        url: resultado.url,
        count: contarRegistros(resultado.data),
        data: resultado.data,
        attempts: intentos
      };
    }

    /*
      Si el endpoint no existe, intentamos el nombre alternativo.
      Para otros errores también conservamos el detalle.
    */
    if (
      resultado.status !== 404 &&
      resultado.status !== 405
    ) {
      return {
        ok: false,
        endpoint: endpointActual,
        status: resultado.status,
        url: resultado.url,
        count: 0,
        data: null,
        error: resultado.error,
        detail: resultado.detail,
        attempts: intentos
      };
    }
  }

  return {
    ok: false,
    endpoint,
    status:
      intentos.length
        ? intentos[intentos.length - 1].status
        : null,
    count: 0,
    data: null,
    error: "No se encontró un endpoint compatible.",
    attempts: intentos
  };
}

async function ejecutarConsulta({
  endpoint,
  params
}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(
    ([key, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
      ) {
        query.set(key, String(value));
      }
    }
  );

  const url =
    `${CLINPGX_BASE_URL}/${endpoint}` +
    `?${query.toString()}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    const contentType =
      response.headers.get("content-type") || "";

    let body;

    if (contentType.includes("application/json")) {
      body = await response.json();
    } else {
      body = await response.text();
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        url,
        error:
          `ClinPGx respondió con HTTP ${response.status}.`,
        detail: body
      };
    }

    return {
      ok: true,
      status: response.status,
      url,
      data: body
    };

  } catch (error) {
    return {
      ok: false,
      status: null,
      url,
      error: "Error de conexión con ClinPGx.",
      detail:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

function contarRegistros(content) {
  if (!content) {
    return 0;
  }

  if (Array.isArray(content)) {
    return content.length;
  }

  if (Array.isArray(content.data)) {
    return content.data.length;
  }

  if (
    content.data &&
    Array.isArray(content.data.data)
  ) {
    return content.data.data.length;
  }

  if (Array.isArray(content.results)) {
    return content.results.length;
  }

  if (Array.isArray(content.items)) {
    return content.items.length;
  }

  return 0;
}

function crearAdvertencias(results) {
  const warnings = [];

  Object.entries(results).forEach(
    ([name, result]) => {
      if (!result.ok) {
        warnings.push({
          section: name,
          status: result.status,
          message:
            result.error ||
            "La sección no pudo recuperarse."
        });
      }
    }
  );

  return warnings;
}
