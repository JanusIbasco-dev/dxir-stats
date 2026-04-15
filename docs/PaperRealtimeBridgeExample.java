package live.dxir.stats;

import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

// Example bridge plugin that pushes live events to /api/data.
// The API then broadcasts websocket events (player_join/player_leave/player_update/stats_update).
public final class PaperRealtimeBridgeExample extends JavaPlugin implements Listener {

    private long startedAt;
    private final Map<UUID, Long> lastActive = new HashMap<>();

    @Override
    public void onEnable() {
        startedAt = System.currentTimeMillis();
        Bukkit.getPluginManager().registerEvents(this, this);
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        lastActive.put(event.getPlayer().getUniqueId(), System.currentTimeMillis());
        pushSnapshot();
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        lastActive.remove(event.getPlayer().getUniqueId());
        pushSnapshot();
    }

    @EventHandler
    public void onPlayerMove(PlayerMoveEvent event) {
        if (event.getFrom().distanceSquared(event.getTo()) > 0) {
            lastActive.put(event.getPlayer().getUniqueId(), System.currentTimeMillis());
        }
    }

    private void pushSnapshot() {
        Bukkit.getScheduler().runTaskAsynchronously(this, () -> {
            try {
                URL url = new URL("https://stats.dxir.live/api/data");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);

                StringBuilder playersJson = new StringBuilder("[");
                boolean first = true;
                for (Player player : Bukkit.getOnlinePlayers()) {
                    if (!first) {
                        playersJson.append(',');
                    }
                    first = false;

                    long activeAt = lastActive.getOrDefault(player.getUniqueId(), System.currentTimeMillis());
                    playersJson.append('{')
                        .append("\"name\":\"").append(player.getName()).append("\",")
                        .append("\"uuid\":\"").append(player.getUniqueId().toString().replace("-", "")).append("\",")
                        .append("\"ping\":").append(Math.max(0, player.getPing())).append(',')
                        .append("\"lastActive\":").append(activeAt)
                        .append('}');
                }
                playersJson.append(']');

                long uptimeSeconds = (System.currentTimeMillis() - startedAt) / 1000;
                String payload = "{" +
                    "\"cpu\":0," +
                    "\"ram\":0," +
                    "\"players\":" + Bukkit.getOnlinePlayers().size() + "," +
                    "\"playerList\":" + playersJson + "," +
                    "\"uptime\":" + uptimeSeconds + "," +
                    "\"ip\":\"dxir.live\"," +
                    "\"status\":\"online\"," +
                    "\"time\":\"" + LocalTime.now().withNano(0) + "\"" +
                    "}";

                try (OutputStream stream = connection.getOutputStream()) {
                    stream.write(payload.getBytes(StandardCharsets.UTF_8));
                }

                connection.getInputStream().close();
            } catch (Exception ignored) {
                // Production plugin should log/retry failures.
            }
        });
    }
}

