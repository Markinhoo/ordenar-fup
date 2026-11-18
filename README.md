# Ordenar FUP

Aplicación estática para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador.

## Verificación de documentos

En la pestaña **Verificar documentos**, carga el Excel desde el celular y enfoca con la cámara el número que está debajo de «No. de documento». La página marca el folio solo cuando hay una coincidencia única y exacta con el Excel. También permite tomar una foto, escribir el folio o marcar el registro manualmente. Muestra el total verificado y los pendientes, permite filtrar y descarga un reporte CSV.

El avance se guarda en el navegador asociado al contenido exacto del Excel. Las imágenes y el Excel no se envían a un servidor. El reconocimiento usa Tesseract.js en el dispositivo; su código y modelo de idioma se descargan por Internet la primera vez que se usa.

## Estructura

- `dist/`: sitio listo para publicar, sin compilación.
- `vercel.json`: indica a Vercel que publique `dist/`.

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
