# Sincronización de Kindle independiente de la Mac

## Dictamen

La independencia de la Mac es técnicamente viable trasladando la extracción a una computadora remota. La garantía de no volver a autenticarse en Amazon y de no sufrir ninguna falla no está sustentada por las interfaces disponibles. El objetivo defendible es minimizar las intervenciones, conservar lo ya capturado, recuperarse de interrupciones y detectar cuando el servicio deja de entregar datos nuevos.

El plan original es una mejora de continuidad local, no una solución al objetivo de independencia. Sus primeros tres pasos mantienen a la laptop como requisito para extraer contenido. La parte que podría eliminar ese requisito aparece como un experimento opcional: debe convertirse en la decisión principal, antes de invertir más en mecanismos de sueño y despertar.[^1]

Con cero gasto adicional y ningún equipo nuevo, se recomienda un piloto limitado de GitHub Actions, condicionado a resolver la persistencia segura de la sesión. No se recomienda migrar directamente la producción. Si el piloto falla por autenticación, no hay evidencia que justifique seguir añadiendo trucos hasta prometer estabilidad: deberá flexibilizarse el presupuesto, aceptar reconexiones ocasionales o cambiar la fuente de lectura.

Esta recomendación distingue cero gasto adicional de cero costo total. El workflow actual llama a la API de Anthropic para clasificar highlights. Por tanto, el sistema ya contiene una dependencia de consumo externo; su costo real y sus cuotas no se verificaron en una cuenta de facturación.[^4]

## Objetivos y límites

No necesitar la Mac significa que extracción, credenciales de sesión, almacenamiento, programación y recuperación ordinaria deben funcionar sin archivos, túneles ni procesos servidos desde ella. Una ejecución remota que necesita una nueva exportación de cookies desde la laptop cada pocos días no cumple el objetivo.

No volver a escribir la contraseña y no volver a autenticar son objetivos distintos. Una sesión conservada puede evitar introducir la contraseña durante muchas ejecuciones. Sin embargo, reutilizar su estado no concede control sobre la decisión de Amazon de exigir acceso otra vez. Readwise documenta cierres ocasionales de sesión de Kindle y la necesidad de reconectar; Playwright también contempla renovar estados autenticados que hayan vencido.[^6][^7]

No se encontró una API pública documentada de highlights de Kindle con un contrato de acceso renovable para este caso. Readwise declara que Kindle no ofrece esa API para desarrolladores. La documentación de Login with Amazon consultada describe permisos de perfil, identificador y código postal; esos permisos no equivalen a autorización para consultar highlights. Esto no demuestra que no existan interfaces privadas, sino que no hay una ruta pública respaldada aquí que elimine la dependencia de la sesión web.[^6][^8]

La expiración futura de una cookie no demuestra que Amazon vaya a aceptarla hasta esa fecha. Tampoco una sesión que haya durado semanas demuestra que otra sobrevivirá al cambio de sistema operativo y entorno. El episodio de julio respalda prudencia, pero no permite atribuir con certeza causal el rechazo únicamente al fingerprint del navegador.[^1][^2]

El objetivo de confiabilidad debe empezar cuando el highlight ya sea visible en Amazon. Si el Kindle permanece desconectado, el proceso remoto no puede capturar contenido que todavía no ha llegado al notebook. También existe contenido sujeto a límites de exportación; la arquitectura no puede garantizar recuperar texto que la fuente no entrega.[^6]

## Evidencia local y alcance

El brief reporta 955 libros, 23,387 highlights y fechas para el 87%. Para el periodo medido del 6 de agosto al 5 de septiembre, el plan registra 24 ejecuciones completas, 34 fallidas y cuatro que no comenzaron, sobre 62 previstas. Son cifras históricas proporcionadas en documentos locales, no una medición repetida en esta revisión.[^1][^2]

Se examinó el código local de `my-readwise`, con HEAD `cb93cd8b2935da7ecf4377f52a4720ade47708c8`, junto con la documentación y el service worker de `my-anki`. No se ejecutó una sincronización contra Amazon, no se inspeccionaron cookies ni se verificaron los paneles de producción. Los hallazgos de código identifican caminos posibles y condiciones concretas; no demuestran que cada uno haya ocurrido en producción.[^4][^5]

Existe un documento posterior, `docs/cloud-sync-pilot.md`, todavía sin seguimiento de Git en la copia inspeccionada. Ya rechaza varias premisas del plan antiguo: no presupone portabilidad del perfil, exige persistir el estado actualizado y aclara que una sesión separada no aísla completamente la cuenta. Es una base más sólida para el experimento que el paso cuatro original.[^3]

## Revisión adversaria del plan

### El éxito se declara demasiado pronto

`do_scrape()` llama a `_mark_success()` antes de `merge_and_render()`. Una extracción puede, por tanto, actualizar el marcador local de éxito y luego fallar al guardar o procesar. Además, `push_data()` registra fallas de publicación y regresa sin propagarlas como error al llamador.[^4]

La consecuencia es concreta: “pude leer Amazon” puede confundirse con “los datos llegaron al servicio que construye mis tarjetas”. El arreglo no consiste en volver fatal todo error. Consiste en registrar por separado extracción, guardado y publicación, y definir éxito del producto solamente cuando la versión esperada esté disponible.

Hay un segundo caso en `build-deck.yml`: si falta `PAGE_PUSH_TOKEN`, el paso de publicación imprime una advertencia y termina con código cero. El heartbeat de éxito posterior puede ejecutarse. La aplicación puede seguir mostrando un mazo anterior mientras el sistema de ejecución informa éxito.[^4]

### Un archivo reciente no demuestra datos recientes

El guardado actual reescribe `library.json`; una ejecución sin highlights nuevos puede cambiar su fecha de archivo local. En el extremo contrario, Git no necesita generar un commit si el contenido es idéntico. La fecha de modificación, la antigüedad del commit y la fecha del último highlight contestan preguntas diferentes.[^4]

La vigilancia propuesta debe usar un registro explícito de última comprobación exitosa del alcance previsto, última persistencia durable y última versión publicada. Volver a generar el mazo con una biblioteca vieja tampoco debe rejuvenecer el estado de la fuente.

### La ejecución parcial no tiene una cola durable

El scraper conserva resultados de libros exitosos si otros fallan, lo cual protege progreso útil. Sin embargo, su resultado público devuelve entradas y los libros fallidos quedan principalmente en logs. El mensaje de que “la siguiente ejecución los reintenta” depende de que sigan entre los libros seleccionados; no hay en esa ruta una cola persistente que garantice atenderlos.[^4]

Además, la descarga agrega libros dentro de una evaluación del navegador. Si este termina abruptamente antes de devolver el resultado, lo acumulado en memoria aún no es una captura durable. Guardar por libro completo permite recuperar desde el último punto confirmado.

La solución mínima es una lista de libros pendientes, con último intento, último éxito y motivo de falla. Una ejecución parcial conserva lo obtenido y queda marcada como parcial. No debe declararse una cobertura completa de la biblioteca por haber recorrido solamente los 75 libros recientes.

### El orden por acceso no garantiza cobertura

El brief establece que el orden del notebook refleja acceso, no necesariamente creación de highlights. Elegir únicamente los primeros libros es una optimización, no una prueba de completitud. Las propias consultas pueden alterar metadatos de acceso, según advierte el piloto local.[^1][^3]

Se recomienda combinar libros recientes, reintentos pendientes y un recorrido rotativo pequeño del resto. Este recorrido sería solo de lectura y captura aditiva. No reactiva el espejo de borrados ni necesita un barrido dominical enorme. La duración y el tamaño de cada lote deben fijarse con mediciones reales.

### La persistencia del archivo es vulnerable a interrupciones

`store.save()` escribe directamente sobre el archivo de biblioteca con `write_text()`. Esa implementación no ofrece un reemplazo atómico: una interrupción durante la escritura puede dejar un archivo incompleto.[^4]

La mejora es escribir una nueva versión temporal, validarla y sustituir el archivo anterior mediante una operación atómica en el mismo sistema de archivos. Debe conservarse una versión anterior recuperable y comprobarse su restauración. No hace falta introducir una base de datos distribuida para resolver este problema.

### Mover el navegador también mueve el problema de la sesión

El plan antiguo propone comprimir un perfil creado en macOS, guardarlo como secreto y ejecutarlo en Linux. No contiene una demostración de portabilidad ni de renovación del estado remoto. GitHub limita el tamaño de cada secreto a 48 KB, por lo que tampoco puede suponerse que un perfil completo quepa.[^2][^10]

Los runners estándar pertinentes de GitHub son máquinas nuevas por ejecución. Conservar el acceso requiere cargar el último estado válido y guardar los cambios antes de destruir la máquina. Reutilizar siempre una fotografía inicial de cookies no demuestra continuidad.[^9]

Crear otro perfil separa archivos, pero sigue siendo la misma cuenta de Amazon. No debe prometerse que un desafío o medida sobre la cuenta afectará exclusivamente al piloto. El documento más reciente ya corrige este punto.[^3]

### La nube tampoco garantiza puntualidad absoluta

GitHub documenta retrasos y posibles descartes de trabajos programados bajo carga. También desactiva programaciones en repositorios públicos tras 60 días sin actividad. Por eso, un único cron remoto no basta como prueba de que el proceso siempre corre.[^11]

Existe otro detalle que cambia el diseño: un push realizado con `GITHUB_TOKEN` no dispara normalmente otro workflow de push. Trasladar la extracción a Actions y añadir solamente el disparador sobre `library.json` puede dejar el encadenamiento incompleto. Se recomienda ejecutar la construcción como un job dependiente o invocarla explícitamente.[^12]

### La IA no debe bloquear la conservación de highlights

El workflow actual clasifica antes de construir el mazo. La clasificación puede fallar por una clave ausente, problemas de red, rechazo o respuesta truncada, según el código. Resolver Amazon no elimina esta dependencia.[^4]

Se recomienda guardar y respaldar primero, y clasificar después. Si falla la clasificación, el último mazo válido continúa disponible y los highlights nuevos quedan pendientes. Publicarlos inmediatamente como tarjetas sin clasificación sería una decisión de producto adicional, porque alteraría los filtros actuales; no debe introducirse silenciosamente.

### Los IDs forman parte del historial de aprendizaje

El almacenamiento calcula IDs a partir del libro, ubicación y texto; al reconocer una edición puede sustituir el ID anterior. El constructor de tarjetas utiliza ese ID y la aplicación conserva estado de repaso asociado a identidades de tarjeta.[^4][^5]

Antes de fusionar duplicados o limpiar registros debe verificarse que la operación no deje el historial de repaso vinculado a IDs desaparecidos. Este riesgo es independiente de la nube. La limpieza de los avisos conocidos puede adelantarse, pero las fusiones requieren conservar equivalencias y probar la recuperación del progreso.

## Alternativas

### Mantener la laptop con mejoras

Es la opción de menor cambio y conserva el entorno actualmente aceptado por Amazon. Mover logs y corregir alertas sigue siendo útil como contención. Sin embargo, no cumple independencia: el propio plan reconoce que cerrar la tapa en batería sigue siendo un límite. No debe convertirse en el destino del proyecto.[^2]

### GitHub Actions con estado persistido

Es la primera opción experimental bajo cero gasto adicional porque el sistema ya lo utiliza. Debe medirse la cuota disponible de la cuenta: GitHub Free incluye 2,000 minutos mensuales para repositorios privados, y los runners estándar de repositorios públicos tienen un tratamiento distinto. No se verificó el saldo disponible ni la visibilidad remota de `my-readwise`.[^13]

Como cálculo ilustrativo, dos ejecuciones diarias de diez minutos consumirían 600 minutos en treinta días, antes de construcción, pruebas, reintentos y otros proyectos. No es una estimación medida. Poner contenido personal en un repositorio público para obtener minutos no debe formar parte de la solución.

Su mayor debilidad es reconstruir entorno y sesión en cada ejecución. La probabilidad de aceptación de Amazon desde ese entorno es desconocida. El piloto debe responderla antes de comprometer la migración.

### Servidor gratuito persistente

Una máquina persistente reduce la necesidad de transportar el perfil en cada corrida. Sin embargo, Oracle advierte que puede recuperar instancias Always Free inactivas. Una tarea breve unas veces al día no debe apoyarse en la suposición de que ese servidor permanecerá asignado indefinidamente.[^14]

Google ofrece una `e2-micro` dentro de límites y regiones específicos, pero la IPv4 externa estándar tiene precio documentado de USD 0.005 por hora y solo una hora mensual gratuita. En 720 horas, el componente de dirección sería aproximadamente USD 3.595 después de esa hora, sin otros cargos. Por tanto, “VM gratuita” no equivale automáticamente a servidor completo de costo cero.[^15]

No se recomienda convertir este proyecto en una búsqueda de combinaciones gratuitas complejas de redes y navegadores. La compatibilidad de Chrome, la memoria disponible, la región y los costos de almacenamiento deben probarse; una cuota atractiva no demuestra aptitud para la tarea.

### Servidor persistente de pago

Es la alternativa más coherente si se permite un gasto pequeño para reducir cambios de entorno. Como referencia concreta, AWS documenta un paquete Linux de Lightsail con 1 GB y IPv4 pública a USD 7 mensuales. El tamaño adecuado debe medirse con Chrome; no se afirma que 1 GB baste para esta biblioteca. Respaldo, impuestos y recursos adicionales pueden aumentar el total.[^16]

Una máquina con perfil durable y dirección estable simplifica la operación. Que eso reduzca desafíos de Amazon es una hipótesis razonable, no un resultado demostrado. Tampoco elimina actualizaciones, caídas del proveedor o futuras reconexiones. El presupuesto compra control del entorno, no acceso perpetuo a una cuenta ajena al sistema.

### Readwise o exportación manual

Readwise usa una extensión de navegador para sincronizar Kindle y documenta reconexiones ocasionales. No resuelve por sí solo el requisito estricto. La importación de `My Clippings.txt` puede servir como recuperación mediante archivo, pero requiere obtenerlo del dispositivo y deja de ser un flujo desatendido.[^6]

Si cero dependencia de autenticación de Amazon es un requisito no negociable, la salida es cambiar el origen de las capturas futuras por uno bajo control propio o con una integración soportada. Eso cambia la experiencia de lectura y no debe presentarse como una simple mejora técnica del scraper.

## Arquitectura mínima propuesta

El flujo recomendado es: Amazon disponible → extracción remota → guardado validado por libro → biblioteca durable → clasificación pendiente → construcción → publicación → comprobación de versión servida. Un monitor externo observa las señales de avance. Cada transición registra su resultado y puede repetirse sin duplicar contenido.

La sesión reside separada de los highlights. Para el piloto gratuito, debe existir un mecanismo explícito de almacenamiento cifrado y versionado del estado actualizado, con la clave fuera de ese contenido. Una implementación posible es un repositorio privado dedicado al estado cifrado, con permisos restringidos y un solo escritor; debe verificarse el tamaño y costo antes de adoptarlo. No debe usarse una caché descartable como única copia de la sesión.[^7][^10]

El flujo de autenticación inicial se mantiene como condición abierta. Preferentemente se crea en el entorno de destino, si existe una vía interactiva compatible; alternativamente, se prueba una exportación autorizada de estado, sin asumir que funcionará. Si no puede iniciarse y conservarse sin un mecanismo frágil, el piloto no pasa. Guardar la contraseña o intentar automatizar desafíos no resuelve esa condición.

La publicación debe identificar la versión de biblioteca de origen y la versión del mazo. Un commit exitoso no demuestra que GitHub Pages ya sirva la versión nueva. La comprobación debe leer el recurso publicado con una política que evite confundir la caché y verificar su identificador. La actualización en un teléfono desconectado solo ocurrirá cuando recupere conexión; esa latencia queda fuera del objetivo de publicación remota.

El monitor debe recibir señales de inicio, resultado parcial, éxito completo y falla, según el alcance definido. Healthchecks admite periodos, gracia y señales de inicio/éxito para detectar ejecuciones que nunca terminan. Conviene vigilar por separado captura y entrega del mazo, evitando que un éxito aguas abajo esconda una fuente vieja.[^17]

La exclusión mutua debe cubrir al escritor de la sesión y al de la biblioteca. El `flock` local no coordina por sí solo una Mac y un runner remoto. Durante el piloto remoto no se escribe producción; en la migración se designa un único escritor autorizado y se desactiva el anterior al completar el cambio.

## Plan mejorado y criterios de aceptación

### Primera etapa: estados veraces y recuperación

Corregir los marcadores de éxito, hacer atómico el guardado y convertir fallas de publicación en estados visibles. Añadir una cola pequeña de pendientes por libro y un registro de versiones. Mover logs y probar que el monitor alerta cuando no recibe la finalización esperada. Estos cambios son útiles tanto si se migra como si el piloto no funciona.

Limpiar los 489 avisos reportados y añadir una regla para no capturarlos nuevamente. La regla debe identificar el aviso, evitando eliminar highlights legítimos por una coincidencia textual demasiado amplia. Mantener el espejo de borrados pausado y preservar el historial antes de cualquier fusión.

### Segunda etapa: piloto remoto aislado

Usar como base el piloto local existente: hasta tres libros, sin publicación, sin fechas del endpoint interno y sin invocar la ruta completa de `sync.py`. Ejecutar en al menos tres días distintos y comprobar que el estado actualizado sobrevive a la destrucción del runner. Se detiene ante desafíos de autenticación, imposibilidad de persistir estado o impacto en el acceso habitual.[^3]

Completar este paso demuestra viabilidad puntual. Las 48 horas propuestas originalmente no prueban continuidad suficiente para retirar la ruta actual. Se recomienda una observación posterior de 14 días con duración, cobertura, reintentos y consumo registrados. Ese plazo es un criterio operativo propuesto, no una garantía estadística de ausencia de futuras fallas.

### Tercera etapa: probar fallas deliberadas

Interrumpir el proceso después de guardar un libro debe conservar ese libro y permitir reanudar. Cortar una escritura no debe reemplazar la última biblioteca válida por JSON incompleto. Un timeout o un error temporal de Amazon no debe mandar una instrucción falsa de login.

Una respuesta HTTP exitosa sin estructura reconocible debe quedar como indeterminada, no como libro vacío. Llegar al límite de paginación con páginas pendientes debe reportar cobertura incompleta. El scraper actual limita el bucle a 40 páginas; el criterio de término debe distinguir ese límite de un fin real de contenido.[^4]

Quitar el token de publicación debe impedir declarar entrega exitosa. Una falla del clasificador debe conservar los highlights nuevos y el mazo anterior. Una corrida repetida debe producir el mismo contenido lógico sin duplicar tarjetas. Dos ejecuciones coincidentes no deben sobrescribir estados más recientes.

La falta de un heartbeat debe producir una alerta recibida y verificada; generar un mazo desde datos viejos no debe apagar esa alerta. Una reconexión real de Amazon debe detener reintentos insistentes, conservar la biblioteca y ofrecer una acción única de recuperación.

### Cuarta etapa: migración y seguimiento

Después de superar las pruebas, activar un solo escritor remoto y comprobar extracción, almacenamiento y publicación sin ninguna dependencia de la Mac. Mantener una copia de recuperación y un procedimiento explícito para volver temporalmente a la ruta local. Esa vuelta sería una contingencia y suspendería el cumplimiento de independencia; no se contaría como éxito remoto.

Se proponen como metas iniciales: 95% de capturas elegibles visibles en el mazo en 24 horas, detección de falta de avance en menos de 24 horas y ninguna pérdida de datos ya confirmados en las pruebas de recuperación. “Elegible” significa visible en Amazon, seleccionado para repaso y dentro de la cobertura declarada. Son objetivos a validar, no promesas de rendimiento observado.

Para medir latencia, usar el momento de visibilidad comprobada en Amazon o una captura de prueba controlada. `modifiedTimestamp` no se tratará automáticamente como fecha de creación. La cobertura rotativa del resto de la biblioteca se medirá por separado, evitando aprobar el servicio por buen desempeño en solo tres libros fáciles.

## Decisión recomendada

El plan se aprueba parcialmente: vigilancia independiente, datos aditivos y encadenamiento explícito son decisiones correctas. Se rechaza como solución final seguir perfeccionando el horario de la laptop. También se rechaza prometer sesiones permanentes o considerar una prueba breve como evidencia de fiabilidad indefinida.

La siguiente inversión debe responder una pregunta concreta: ¿puede una sesión remota autorizada mantenerse con su estado actualizado, dentro de la cuota disponible y sin depender de la Mac? Si la respuesta es sí, se migra con recuperación y vigilancia. Si es no, la decisión es de producto: aceptar gasto adicional, aceptar alguna intervención o cambiar el origen de lectura. No existe evidencia suficiente para prometer simultáneamente cero gasto, cero reconexiones y cero fallas.

## Fuentes

Las páginas web se consultaron el 12 de septiembre de 2026. Cuando no muestran fecha de publicación inequívoca, se identifica la fecha de consulta en lugar de inventar una. Los registros locales documentan este sistema particular y no son fuentes públicas independientes.

[^1]: Hector Flores, «Brief para otro asistente — my-readwise / my-anki», archivo aportado, sin fecha editorial explícita; consultado el 12 de septiembre de 2026. [Archivo local](/Users/hectorcflores/.codex/attachments/12d0512e-6c74-4950-b81a-fbede63c36dd/pasted-text.txt). Datos históricos, incidentes, restricciones y pendientes.

[^2]: «Make the Kindle sync survive the laptop (no new hardware)», plan local, sin fecha editorial explícita. [Archivo local](/Users/hectorcflores/.claude/plans/noto-que-a-pesar-wiggly-fog.md). Medición histórica y propuesta original.

[^3]: «Prueba de sincronización Kindle en la nube», documento local sin seguimiento de Git al inspeccionarlo. [Archivo local](/Users/hectorcflores/Documents/projects/my-readwise/docs/cloud-sync-pilot.md). Propuesta, no evidencia de piloto ejecutado.

[^4]: Código local de my-readwise, HEAD `cb93cd8b2935da7ecf4377f52a4720ade47708c8`: [sync.py](/Users/hectorcflores/Documents/projects/my-readwise/sync.py), [scraper.py](/Users/hectorcflores/Documents/projects/my-readwise/myreadwise/scraper.py), [store.py](/Users/hectorcflores/Documents/projects/my-readwise/myreadwise/store.py), [build-deck.yml](/Users/hectorcflores/Documents/projects/my-readwise/.github/workflows/build-deck.yml), [build_deck.py](/Users/hectorcflores/Documents/projects/my-readwise/build_deck.py) y [classify.py](/Users/hectorcflores/Documents/projects/my-readwise/classify.py). Inspección estática, no ejecución contra producción.

[^5]: my-anki, [README.md](/Users/hectorcflores/Documents/projects/my-anki/README.md) y [sw.js](/Users/hectorcflores/Documents/projects/my-anki/app/sw.js). Persistencia de repasos y caché de la aplicación.

[^6]: Readwise, [Import from Amazon Kindle](https://docs.readwise.io/readwise/docs/importing-highlights/kindle). Extensión, reconexiones, ausencia de API de highlights según el integrador, límites e importación de archivos.

[^7]: Microsoft Playwright, [Authentication](https://playwright.dev/docs/auth). Reutilización, caducidad y sensibilidad del estado autenticado.

[^8]: Amazon Developer, [Customer Profile — Login with Amazon](https://developer.amazon.com/docs/login-with-amazon/customer-profile.html). Permisos públicos documentados de perfil; no otorgan acceso a highlights.

[^9]: GitHub, [GitHub-hosted runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners). Entornos de ejecución nuevos; excepción documentada de runners de una CPU.

[^10]: GitHub, [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets). Límite de 48 KB y alternativa de almacenamiento cifrado.

[^11]: GitHub, [Events that trigger workflows — schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Retrasos, descartes e inactividad de repositorios públicos.

[^12]: GitHub, [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). Comportamiento de eventos producidos con `GITHUB_TOKEN`.

[^13]: GitHub, [Product usage included with each plan](https://docs.github.com/en/billing/reference/product-usage-included) y [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Cuotas y alcance por tipo de repositorio. El cálculo de 600 minutos es propio.

[^14]: Oracle, [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm). Recuperación de instancias inactivas y restricciones de recursos.

[^15]: Google Cloud, [Free Google Cloud features and trial offer](https://docs.cloud.google.com/free/docs/free-cloud-features) y [Network pricing](https://cloud.google.com/vpc/network-pricing). Cuota e2-micro y precio de IPv4. El cálculo de USD 3.595 es propio: `(720 − 1) × 0.005`.

[^16]: AWS, [Lightsail instance bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html). Referencia de paquete Linux con IPv4; precio base, no presupuesto completo de la solución.

[^17]: Healthchecks.io, [Configuring Checks](https://healthchecks.io/docs/configuring_checks/) y [Measuring Script Run Time](https://healthchecks.io/docs/measuring_script_run_time/). Periodos, gracia y señales de inicio/finalización.
