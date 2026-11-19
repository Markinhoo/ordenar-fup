# Ordenar FUP

Aplicación React con Vite para ordenar RFC y folios dentro de una plantilla Excel, repartir los registros entre personas con colores y verificar los documentos físicos por su número de folio. El archivo se procesa en el navegador. El tema claro u oscuro se guarda en este proyecto. El selector animado de sol y luna sigue el patrón del Gestor de Contestaciones y el menú lateral plegable sigue el de hechi-go; el diseño de Ordenar FUP usa una paleta neutra.

## Nuevo control compartido de documentos

La portada abre el login antes de mostrar el sistema. La cuenta administradora `nomina@fup.com` puede cargar el Excel, ordenar y descargar el archivo, elegir mes y quincena, y seleccionar las personas por nombre entre las cuentas creadas en **Usuarios**. El reparto de registros se calcula automáticamente, con una diferencia máxima de un registro entre personas. La QNA usa `AAAANN`: enero primera `202601`, enero segunda `202602` y diciembre segunda `202624`. En **Usuarios** crea las cuentas del equipo; el sistema genera una contraseña inicial y confirma la cuenta sin enviar correo. El resto del equipo solo ve la verificación después de iniciar sesión y abrir su QR. Los registros quedan ordenados por RFC y repartidos en ese orden. Cada persona recibe un QR distinto, ligado internamente a su cuenta. El QR se genera de nuevo para cada lote.

Cada usuario puede cambiar su contraseña y configurar una pregunta de respaldo privada en **Mi cuenta**. Si olvida la contraseña, la restablece con su respuesta. Solo se guarda un hash de esa respuesta; tras cinco intentos fallidos, la recuperación se bloquea durante 30 minutos. La cuenta administradora inicial usa un enlace de activación de un solo uso para definir contraseña y pregunta de respaldo, sin confirmar por correo.

Cada colaborador ve el avance general y su asignación. Para registrar un documento, enfoca con el celular el recuadro completo o toma una foto: el lector extrae procedencia, nivel, número de documento y fecha, y pide confirmar la lectura. La casilla del listado está deshabilitada para colaboradores. La encargada puede marcar o desmarcar manualmente con una observación obligatoria. También puede añadir un documento físico ausente del Excel con folio, datos del recuadro y motivo. Todo movimiento queda en la bitácora, con QNA, responsable y fecha; se puede buscar en QNAs anteriores y descargar un CSV completo.

La información del nuevo control se guarda solo en tablas `v2_*` del esquema aislado `"fup-sep"` del proyecto Supabase **aria-arquitectura**. El Excel original y las imágenes capturadas se procesan en el navegador y no se guardan. El progreso se actualiza cada cinco segundos. La lectura de texto usa Tesseract.js en el dispositivo y necesita Internet para descargar el lector la primera vez.

## Verificación anterior

Las salas creadas antes del sistema de cuentas se abren ahora en una pantalla React. Los enlaces anteriores `organizar.html?s=...` siguen funcionando y muestran esa sala; los QR nuevos de esas salas usan `/sala?s=...`. El control actual usa cuentas y QNAs.

## Base de datos

La activación inicial usa `supabase/fup-sep-v5.sql`. La consulta `select "fup-sep".v4_issue_admin_activation();` genera un token aleatorio que vence en 24 horas. El token se entrega al administrador en el fragmento `#token=` de `/activar` y no se guarda en GitHub. La ruta anterior `activar.html` también funciona. `supabase/fup-sep-v6.sql` convierte las QNA anteriores al formato `AAAANN` y hace el reparto en el servidor a partir de la cantidad de registros y personas.

El SQL original está en `supabase/fup-sep.sql`, el control compartido en `supabase/fup-sep-v2.sql`, la restricción de administrador en `supabase/fup-sep-v3.sql` y el directorio de cuentas y recuperación en `supabase/fup-sep-v4.sql`. El esquema `fup-sep` debe permanecer en **Exposed schemas** de Data API. Las tablas nuevas tienen RLS y no conceden acceso directo a visitantes. La lista de administradores vive en `"fup-sep".v2_admin_accounts`. La función `supabase/functions/fup-accounts/index.ts` se publica en Supabase y usa la clave de servicio que Supabase le proporciona internamente. No se guarda esa clave en Vercel ni en GitHub.

## Estructura

- `index.html`: única entrada HTML necesaria para montar React.
- `src/pages/`: pantallas React de control, organizador, activación y salas anteriores.
- `src/components/`: pantallas de acceso, cuentas, lote, lista, escáner y bitácora.
- `src/lib/`: API, Excel, OCR, QR, QNA, descarga y tema.
- `src/styles/`: estilos de cada vista y temas.
- `dist/`: resultado generado por Vite; contiene una copia compilada de `index.html` y no se guarda en Git.
- `vercel.json`: compila el proyecto y publica `dist/` en Vercel.

## Ejecutar en la computadora

Con Node.js instalado, abre una terminal en `C:\Users\Marko\ordenar-fup` y ejecuta:

```powershell
npm install
npm run dev
```

Abre la dirección local que muestre Vite (normalmente `http://127.0.0.1:5173`). Usa `npm run build` para comprobar la compilación y `Ctrl+C` para detener el servidor.

El generador QR usa la dependencia [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator).

El proyecto `ordenar-fup` en Vercel está conectado a la rama `main` de `Markinhoo/ordenar-fup`. Los cambios enviados a esa rama generan despliegues automáticos.
