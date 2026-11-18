# Ordenar FUP

Aplicación estática para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador.

## Verificación de documentos

En la pestaña **Verificar documentos**, carga el Excel desde una computadora: se crea automáticamente un enlace privado de equipo. Quien abre ese enlace en un celular recibe el listado sin volver a cargar el archivo. Si abre solo la página principal de Vercel, puede pegar el enlace en **¿Ya tienes el enlace del equipo?**. El navegador recuerda la última sala abierta. Enfoca con la cámara el número debajo de «No. de documento». La página marca el folio solo cuando hay una coincidencia única y exacta. Si el escaneo en vivo no está disponible, usa **Abrir cámara para tomar foto**. También permite escribir el folio o marcarlo manualmente. Muestra verificados y pendientes, permite filtrar y descarga un reporte CSV. Las marcas se sincronizan aproximadamente cada cuatro segundos.

Antes de crear el enlace, el avance solo se guarda en el navegador asociado al Excel. Al crear el enlace, **folio, RFC y marcas** se guardan en el esquema aislado `"fup-sep"` de la base de datos Supabase del proyecto Aria. El Excel original y las fotos no se suben. El enlace contiene una clave aleatoria que da acceso a la lista; compártelo solo con el equipo. El reconocimiento usa Tesseract.js en el dispositivo; su código y modelo de idioma se descargan por Internet la primera vez que se usa.

## Base de datos

El SQL para crear el esquema, tablas y funciones está en `supabase/fup-sep.sql`. En la configuración Data API del proyecto Supabase de Aria hay que agregar `fup-sep` a **Exposed schemas**, conservando los esquemas existentes. Solo se otorga a `anon` ejecución de las cuatro funciones del esquema; las tablas tienen RLS activada y no tienen permisos directos para visitantes.

## Estructura

- `dist/`: sitio listo para publicar, sin compilación.
- `vercel.json`: indica a Vercel que publique `dist/`.

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
