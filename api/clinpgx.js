export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método no permitido"
    });
  }

  const drug = String(req.query.drug || "").trim();
  const gene = String(req.query.gene || "").trim();

  if (!drug) {
    return res.status(400).json({
      error: "Debe indicar el nombre del medicamento."
    });
  }

  try {
    const params = new URLSearchParams({
      "relatedChemicals.name": drug,
      view: "max"
    });

    if (gene) {
      params.set("location.genes.symbol", gene);
    }

    const apiUrl =
      `https://api.clinpgx.org/v1/data/clinicalAnnotation?${params.toString()}`;

    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const detail = await response.text();

      return res.status(response.status).json({
        error: "ClinPGx no respondió correctamente.",
        status: response.status,
        detail
      });
    }

    const data = await response.json();

    return res.status(200).json({
      source: "ClinPGx",
      drug,
      gene: gene || null,
      data
    });
  } catch (error) {
    return res.status(500).json({
      error: "No fue posible consultar ClinPGx.",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
