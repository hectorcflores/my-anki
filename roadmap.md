# Roadmap: My Anki para iPhone y sincronización de Kindle

## Objetivo

Construir una app privada de **My Anki para iPhone** que sea la experiencia principal para estudiar highlights, junto con una sincronización de Kindle que funcione silenciosamente:

- La app de iPhone muestra las tarjetas, ejecuta el sistema Again/Hard/Good/Easy y conserva el progreso aun sin conexión.
- El sitio y la app comparten tarjetas, repasos y tarjetas ocultas mediante la misma cuenta.
- Una extensión de Chrome lee los highlights desde `read.amazon.com/notebook` usando la sesión normal de Amazon del usuario.
- La contraseña y las cookies de Amazon nunca se envían a My Anki, Firebase, GitHub ni a un asistente.
- La extensión detecta highlights nuevos, evita duplicados y los entrega a My Anki automáticamente cuando Chrome está disponible.
- Después de recibirlos, la nube puede procesarlos y publicarlos aunque la Mac se apague.
- La app de iPhone informa el estado de la última actualización, pero no intenta leer la app Kindle ni guardar credenciales de Amazon.
- Si Amazon cierra la sesión, My Anki muestra una instrucción clara para iniciar sesión directamente en Amazon y continúa después de hacerlo.

El objetivo no es prometer que Amazon nunca volverá a pedir autenticación. Amazon controla la sesión y puede cerrarla. El resultado defendible es que la reconexión sea infrecuente, directa con Amazon, fácil de entender y recuperable sin perder highlights.

Readwise se usa solamente como evidencia de que el patrón extensión de escritorio → nube → app móvil es viable. No es una dependencia de My Anki. Referencia oficial: [Readwise — Import from Amazon Kindle](https://docs.readwise.io/readwise/docs/importing-highlights/kindle).

## Decisión de arquitectura

El flujo será:

`Kindle → extensión de Chrome → nube de My Anki → app de iPhone`

La app de iPhone y la extensión tienen responsabilidades distintas. La app sirve para estudiar y consultar el estado. La extensión obtiene los highlights porque iOS no permite que una app lea directamente los datos privados de la app Kindle ni reutilice la sesión de Amazon de Chrome.

La primera app se construirá en SwiftUI y se distribuirá privadamente mediante TestFlight. El sitio instalable actual se mantiene como respaldo hasta que la app nativa demuestre paridad. Una envoltura simple del sitio puede servir para una prueba rápida, pero no será la arquitectura final porque aportaría poco frente a instalar el sitio en la pantalla de inicio.

## Experiencia final esperada

1. Hector instala **My Anki** desde TestFlight e inicia sesión con su cuenta.
2. Puede revisar tarjetas en el iPhone, incluso temporalmente sin conexión.
3. Hector instala la extensión **My Anki** una sola vez en Chrome e inicia sesión directamente en Amazon si Amazon lo solicita.
4. La extensión revisa Kindle al abrir Chrome y periódicamente mientras Chrome está funcionando.
5. Los highlights nuevos llegan a la app de iPhone sin acciones manuales y sin duplicarse.
6. La Mac puede apagarse después de la captura; el procesamiento pendiente continúa en la nube.
7. Si Amazon cierra la sesión, la app y la extensión muestran **“Sign in to Amazon”**. Después del login, la sincronización se reanuda desde donde quedó.

## Límites aceptados

- La extensión no puede extraer highlights nuevos mientras la Mac está apagada. Se pone al día la próxima vez que Chrome se abre.
- La app de iPhone no elimina esta dependencia: reemplaza la experiencia de estudio web, no el acceso a Amazon.
- No se puede garantizar una sesión perpetua de Amazon. Readwise tampoco ofrece esa garantía.
- La primera versión es privada para Hector. App Store pública, Firefox, múltiples usuarios y una extensión de Safari para iPhone quedan fuera de este roadmap.
- TestFlight requiere una membresía activa de Apple Developer. No se pagará ni se activará sin una decisión explícita.
- No se habilitará facturación ni un servicio de pago sin una decisión explícita.

## Estado actual

- La extensión puede leer un libro real desde el Kindle Notebook abierto en Chrome.
- La extracción se realiza dentro de la sesión normal de Amazon y no requiere entregar la contraseña.
- El sitio actual ya funciona como aplicación web instalable y seguirá siendo el respaldo.
- Todavía no existe un proyecto nativo de iPhone ni una versión de TestFlight.
- El icono `myA` está aplicado al sitio y a la extensión.
- My Anki ya usa su propio proyecto Firebase (`my-anki-hector`). Ya no comparte lecturas, escrituras ni cuota con Pomodoro.
- La cuenta de My Anki, el progreso local y las tarjetas ocultas se migraron sin borrar el calendario de repaso.
- El sitio fue validado en producción mostrando **Synced · just now** contra el backend dedicado.
- La entrega real desde la extensión fue validada con *Million Dollar Weekend*: 31 highlights llegaron en un solo lote y My Anki creó una tarjeta nueva del libro.
- El sistema anterior de extracción y sus alertas no deben retirarse hasta completar una prueba real de extremo a extremo.

## Validación técnica — 26 de septiembre de 2026

| Requisito | Estado | Evidencia |
|---|---|---|
| Aislar My Anki de Pomodoro | Completado | My Anki usa `my-anki-hector`; Pomodoro permanece en `my-reading-list-3fa75`. Una importación ya no puede consumir la cuota de Pomodoro. |
| Evitar gasto repetido de cuota | Completado | Los lotes tienen identificador determinista, las lecturas usan caché y cursor incremental, y un HTTP 429 pausa los reintentos. En operación normal se crea un documento por lote y se consultan solamente lotes posteriores al cursor. |
| Conservar progreso durante la migración | Completado | La migración conserva SRS y tarjetas ocultas, reinicia solamente cursores del backend anterior y publica el estado local como baseline en el proyecto nuevo. |
| Login de Google en producción | Completado | El flujo popup quedó validado en Chrome y el sitio mostró **Synced · just now**. El redirect anterior perdía su resultado entre GitHub Pages y `firebaseapp.com`. |
| Highlight real extensión → My Anki | Completado | Amazon entregó *Million Dollar Weekend* con 31 highlights. La caché local recibió un lote con ID `5115f917ebdbb3cfc50ddd631b076c452b629931`; la app mostró **Recall · Million Dollar Weekend** y el mazo pasó de 98 a 99 tarjetas. |
| Repetición sin duplicados | Completado | Se volvió a abrir el importador con el mismo lote. My Anki quedó sincronizado con 99 tarjetas y la caché de Firestore conservó exactamente un lote con los mismos 31 highlights. |

Fallas reales encontradas y corregidas:

- Las reglas de Firestore no estaban publicadas y el primer envío recibió HTTP 403.
- My Anki y Pomodoro compartían proyecto y cuota; un HTTP 429 afectaba a ambas apps.
- El redirect de Google regresaba a la app sin conservar la sesión.
- La migración consultaba una colección Brain Gym que no existe en el proyecto nuevo.
- Los eventos antiguos de tarjetas ocultas incluían metadatos que las reglas nuevas rechazaban.
- La comunicación externa de la extensión podía quedarse esperando para siempre. La versión 0.1.3 acepta las dos formas válidas del remitente de Chrome, responde los errores y corta la espera con una instrucción recuperable.
- Al completar una entrega, la extensión recargaba también el importador y reiniciaba el mismo lote en un ciclo. Ahora actualiza solamente las pestañas de revisión; el importador puede confirmar el éxito y cerrarse.

Pruebas automatizadas aprobadas:

- 19 escenarios de sincronización y migración entre dispositivos.
- 8 escenarios del scheduler y la sesión de cinco tarjetas.
- Ocultar, deshacer, modo offline, recuperación y aislamiento por cuenta.
- Importación incremental, pausa por cuota y ausencia de escrituras en rutas de Pomodoro.
- ID estable, reintento idempotente y recuperación de la extensión sin abrir pestañas duplicadas.
- Suite de extracción del Kindle Notebook.

Commits principales: `b1b079d`, `bf099a7`, `a55c798`, `210b7b4`, `42a6040` y `7bcf291`.

## Fase 1: estabilizar la infraestructura compartida

Objetivo: garantizar que probar Kindle no pueda descomponer Pomodoro ni consumir la cuota de todo el proyecto.

Trabajo:

- Medir cuántas lecturas y escrituras produce una importación.
- Eliminar consultas completas o repetidas que no sean necesarias.
- Aplicar espera automática cuando Firebase responde con límite de cuota.
- Separar claramente el estado de Pomodoro, My Anki y la bandeja de importación.
- Añadir una prueba que demuestre que una importación de Kindle no modifica las colecciones de Pomodoro.

Criterio de salida: una prueba de importación tiene un costo pequeño y conocido, y Pomodoro continúa sincronizando normalmente.

**Estado: completado.** El aislamiento por proyecto elimina el riesgo compartido. Las pruebas confirman que la ruta de importación no toca datos de Pomodoro.

## Fase 2: completar la entrega segura

Objetivo: llevar un highlight extraído por la extensión hasta My Anki.

Trabajo:

- Autenticar la extensión con la misma cuenta de My Anki sin compartir la sesión de Amazon.
- Subir lotes pequeños, validados y con identificadores estables.
- Guardar cada lote antes de marcarlo como enviado.
- Hacer que repetir una entrega sea seguro y no produzca duplicados.
- Preservar libro, autor, texto, nota, ubicación y fecha disponible.

Criterio de salida: un highlight controlado de Kindle aparece como tarjeta nueva en My Anki, conserva su fuente y no vuelve a crearse al repetir la sincronización.

**Estado: completado.** El lote real se entregó, apareció como tarjeta nueva y una segunda entrega idéntica no creó otro lote ni otra tarjeta.

## Fase 3: automatización y recuperación

Objetivo: quitar la acción manual **“Sync one book”** del uso normal.

Trabajo:

- Revisar Kindle al iniciar Chrome y aproximadamente cada seis horas mientras esté abierto.
- Recorrer libros de forma incremental para evitar cargas grandes.
- Guardar progreso en la extensión para sobrevivir a suspensión, reinicio de Chrome y cierre de su proceso interno.
- Reintentar fallas de red con pausas crecientes.
- Detener reintentos ante una sesión vencida y mostrar **“Sign in to Amazon”**.
- Reanudar automáticamente después de una autenticación válida.

Criterio de salida: cerrar Chrome, dormir la Mac o perder la red durante una captura no pierde datos ni crea duplicados; el siguiente intento continúa desde el último punto seguro.

## Fase 4: estados claros para una persona no técnica

La extensión y My Anki mostrarán solamente estados accionables:

- **Checking Kindle**
- **Sending new highlights**
- **Updated · [time]**
- **Waiting for connection**
- **Sign in to Amazon**
- **My Anki cloud sync paused**

**Updated** solo se mostrará cuando el highlight ya esté disponible en My Anki. No significará únicamente que la extensión intentó ejecutarse.

Criterio de salida: cada falla indica qué ocurrió, si el sistema se recuperará solo y, cuando corresponda, la única acción que Hector debe realizar.

## Fase 5: app nativa para iPhone

Objetivo: convertir My Anki en una app privada para iPhone sin crear un segundo sistema incompatible.

Trabajo:

- Crear el proyecto SwiftUI y conservar el diseño visual actual de My Anki.
- Implementar login, descarga del mazo, modo offline y cola de repasos pendientes.
- Portar exactamente la selección de cinco tarjetas, el interludio automático, Again/Hard/Good/Easy y Hide card.
- Compartir identificadores de tarjeta y formato de eventos con el sitio para conservar el historial existente.
- Mostrar cuándo llegaron los highlights más recientes y si Kindle requiere atención.
- Preparar iconos `myA`, firma, App Store Connect y una distribución privada por TestFlight.
- Mantener el sitio actual disponible como rollback durante todo el piloto.

Criterio de salida: la misma cuenta muestra las mismas tarjetas y el mismo progreso en iPhone y web; un repaso hecho sin conexión llega a la nube al recuperar internet y no se duplica.

Estimación inicial: entre 3 y 7 días de implementación enfocada después de estabilizar el contrato de sincronización, más el tiempo de alta y procesamiento de Apple. Es una estimación, no una promesa.

## Fase 6: pruebas adversarias

Antes de retirar el sistema anterior deben pasar estas pruebas:

- Highlight nuevo real: aparece en My Anki.
- Segunda ejecución idéntica: no crea duplicados.
- Mac apagada después de capturar: la entrega ya iniciada termina en la nube.
- Mac apagada antes de capturar: la extensión se pone al día al volver a abrir Chrome.
- Chrome reiniciado a mitad de captura: continúa sin perder progreso.
- Red interrumpida: conserva el lote y lo reintenta.
- Amazon cierra la sesión: pide login directo en Amazon, no una contraseña dentro de My Anki.
- Login restaurado: continúa sin reinstalar ni reconfigurar la extensión.
- Firebase limitado: conserva los datos, pausa los reintentos y no afecta Pomodoro.
- Cambio inesperado en la página de Amazon: reporta un error de extracción y conserva la última biblioteca válida.
- Repaso offline en iPhone: se conserva al cerrar y volver a abrir la app.
- Repaso simultáneo en web e iPhone: ambos eventos se preservan y convergen.
- Reinstalación de la app: recupera mazo, progreso y tarjetas ocultas desde la cuenta.
- Nueva versión de TestFlight: actualiza sin borrar datos locales pendientes.

## Fase 7: piloto y migración

Ejecutar un piloto de siete días usando principalmente la app de iPhone, con highlights creados en días distintos. Registrar captura, entrega, publicación, repasos offline, duplicados, reconexiones y consumo de Firebase.

Solo después del piloto:

- Desactivar el scraper antiguo de Amazon.
- Desactivar sus tareas locales y alertas de Healthchecks.
- Conservar una copia recuperable de su configuración durante el periodo inicial.
- Mantener un solo mecanismo autorizado para escribir nuevos highlights.

## Definición de terminado

El proyecto se considera terminado cuando:

- Un highlight real nuevo llega automáticamente desde Kindle hasta My Anki.
- Ese highlight aparece en la app de iPhone sin una actualización manual.
- Repetir la sincronización no duplica tarjetas.
- La extensión se recupera de suspensión, reinicio y pérdida de red.
- Una sesión vencida de Amazon produce una instrucción clara y se recupera después del login.
- Ninguna contraseña o cookie de Amazon sale del navegador.
- La app funciona offline, conserva repasos pendientes y converge con el sitio al recuperar conexión.
- Reinstalar la app recupera el historial y las tarjetas ocultas de la cuenta.
- Pomodoro y las demás aplicaciones compartidas continúan funcionando dentro de la cuota.
- El piloto de siete días termina sin pérdida de datos.
- El sistema anterior y sus alertas se retiran únicamente después de cumplir todo lo anterior.

Pasar una sola prueba de extremo a extremo demuestra que la arquitectura funciona. No demuestra que Amazon nunca volverá a cerrar la sesión; esa confiabilidad se evalúa durante el piloto y se mantiene con monitoreo y recuperación claros.
