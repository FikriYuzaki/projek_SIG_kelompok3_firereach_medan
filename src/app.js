import { createSupabaseService } from "./core/supabase.js";
import { createShellLayout } from "./core/layout.js";
import { createMap, addGeoJson, fitBounds } from "./core/map/index.js";
import { createChart } from "./core/charts.js";
import { createNotificationService } from "./core/notifications.js";
import { formatters } from "./core/formatters.js";
import { createDataStatusService } from "./core/data-status.js";
import { createRouter } from "./router/index.js";

export function startApp(rootElement) {
  const supabase = createSupabaseService();
  const shell = createShellLayout(rootElement, supabase);
  const notify = createNotificationService(shell.notificationRegion);
  const dataStatus = createDataStatusService("/data", supabase);

  const services = {
    supabase,
    maps: { createMap, addGeoJson, fitBounds },
    charts: { createChart },
    notify,
    format: formatters,
    dataStatus
  };

  const router = createRouter({ shell, services });
  router.start();

  return { router, services };
}
