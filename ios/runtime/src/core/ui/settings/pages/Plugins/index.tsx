import { Strings } from "@core/i18n";
import type { CardWrapper } from "@core/ui/components/AddonCard";
import AddonPage from "@core/ui/components/AddonPage";
import { type CxAddonRow, useCxAddonRows } from "@core/ui/settings/pages/CxExtensions";
import { AddonActions, CxAddonCard } from "@core/ui/settings/pages/CxExtensions/AddonCard";
import PluginCard from "@core/ui/settings/pages/Plugins/components/PluginCard";
import { VdPluginManager } from "@core/vendetta/plugins";
import { useProxy } from "@core/vendetta/storage";
import { isCorePlugin, isPluginInstalled, pluginSettings, registeredPlugins, corePluginInstances } from "@lib/addons/plugins";
import { Author } from "@lib/addons/types";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { useObservable } from "@lib/api/storage";
import { showToast } from "@lib/ui/toasts";
import { BUNNY_PROXY_PREFIX, VD_PROXY_PREFIX } from "@lib/utils/constants";
import { lazyDestructure } from "@lib/utils/lazy";
import { findByProps } from "@metro";
import { NavigationNative } from "@metro/common";
import {
  Button,
  Card,
  FlashList,
  IconButton,
  Text,
} from "@metro/common/components";
import { ComponentProps } from "react";
import { View } from "react-native";

import { UnifiedPluginModel } from "./models";
import unifyBunnyPlugin from "./models/bunny";
import unifyVdPlugin from "./models/vendetta";

const { openAlert } = lazyDestructure(() =>
  findByProps("openAlert", "dismissAlert"),
);
const { AlertModal, AlertActions, AlertActionButton } = lazyDestructure(() =>
  findByProps("AlertModal", "AlertActions"),
);

type PluginRow = UnifiedPluginModel | (CxAddonRow & { alternate?: boolean });
type PluginPageProps = Partial<ComponentProps<typeof AddonPage<PluginRow>>> & { useItems: () => PluginRow[]; };
const isPluginRowEnabled = (item: PluginRow) => "source" in item ? item.active : item.isEnabled();
const pluginFilters = {
  "Private commands": (item: PluginRow) => "source" in item && item.privateCommands === true,
  "Needs review": (item: PluginRow) => "source" in item && item.needsReview === true,
};
const showDefaultRow = (item: PluginRow) => !("source" in item && item.alternate);

function PluginListCard({ item, result }: CardWrapper<PluginRow>) {
  return "source" in item
    ? <CxAddonCard kind="plugin" entry={item} />
    : <PluginCard item={item} result={result as Fuzzysort.KeysResult<UnifiedPluginModel>} />;
}

function PluginPage(props: PluginPageProps) {
  const items = props.useItems();

  return (
    <AddonPage<PluginRow>
      CardComponent={PluginListCard}
      isEnabled={isPluginRowEnabled}
      title={Strings.PLUGINS}
      filterOptions={pluginFilters}
      defaultFilter={showDefaultRow}
      searchKeywords={[
        "name",
        "description",
        (p) =>
          ("source" in p ? [p.keywords, ...(p.commands ?? []).map(command => "/" + command)].filter(Boolean).join(" ") : p.authors
            ?.map((a: Author | string) => (typeof a === "string" ? a : a.name))
            .join()) || "",
      ]}
      sortOptions={{
        "Name (A-Z)": (a, b) => a.name.localeCompare(b.name),
        "Name (Z-A)": (a, b) => b.name.localeCompare(a.name),
      }}
      safeModeHint={{ message: Strings.SAFE_MODE_NOTICE_PLUGINS }}
      items={items}
      {...props}
    />
  );
}

export default function Plugins() {
  useProxy(settings);
  const navigation = NavigationNative.useNavigation();

  return (
    <PluginPage
      useItems={() => {
        useProxy(VdPluginManager.plugins);
        useObservable([pluginSettings]);

            const corePlugins = [...registeredPlugins.values()].filter(p => isPluginInstalled(p.id) && isCorePlugin(p.id)).map(unifyBunnyPlugin);
            const vdPlugins = Object.values(VdPluginManager.plugins).map(unifyVdPlugin);
            const bnPlugins = [...registeredPlugins.values()].filter(p => isPluginInstalled(p.id) && !isCorePlugin(p.id)).map(unifyBunnyPlugin);
            const catalog = useCxAddonRows("plugin");
            const native = [...corePlugins, ...vdPlugins, ...bnPlugins];
            const nativeNames = new Set(native.map(plugin => plugin.name.toLowerCase()));
            const entries = catalog.map(plugin => !plugin.active && nativeNames.has(plugin.name.toLowerCase())
              ? { ...plugin, alternate: true } : plugin);
            return [...native, ...entries];
        }}
        ListHeaderComponent={() => {
            const unproxiedPlugins = Object.values(VdPluginManager.plugins).filter(p => !p.id.startsWith(VD_PROXY_PREFIX) && !p.id.startsWith(BUNNY_PROXY_PREFIX));
            if (!unproxiedPlugins.length) return <AddonActions kind="plugin" />;

        return (
          <View style={{ marginVertical: 12, marginHorizontal: 10 }}>
            <AddonActions kind="plugin" />
            <Card border="strong">
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  flexDirection: "row",
                }}
              >
                <View style={{ gap: 6, flexShrink: 1 }}>
                  <Text variant="heading-md/bold">Unproxied Plugins Found</Text>
                  <Text variant="text-sm/medium" color="text-muted">
                    Plugins installed from unproxied sources may run unverified
                    code in this app without your awareness.
                  </Text>
                </View>
                <View style={{ marginLeft: "auto" }}>
                  <IconButton
                    size="sm"
                    variant="secondary"
                    icon={findAssetId("CircleInformationIcon-primary")}
                    style={{ marginLeft: 8 }}
                    onPress={() => {
                      navigation.push("PUPU_CUSTOM_PAGE", {
                        title: "Unproxied Plugins",
                        render: () => {
                          return (
                            <FlashList
                              data={unproxiedPlugins}
                              contentContainerStyle={{ padding: 8 }}
                              ItemSeparatorComponent={() => (
                                <View style={{ height: 8 }} />
                              )}
                              renderItem={({ item: p }: any) => (
                                <Card>
                                  <Text variant="heading-md/semibold">
                                    {p.id}
                                  </Text>
                                </Card>
                              )}
                            />
                          );
                        },
                      });
                    }}
                  />
                </View>
              </View>
            </Card>
          </View>
        );
      }}
      installAction={{
        label: "Install a plugin",
        fetchFn: async (url: string) => {
          if (
            !url.startsWith(VD_PROXY_PREFIX) &&
            !url.startsWith(BUNNY_PROXY_PREFIX) &&
            !settings.developerSettings
          ) {
            openAlert(
              "bunny-plugin-unproxied-confirmation",
              <AlertModal
                title="Hold On!"
                content="You're trying to install a plugin from an unproxied external source. This means you're trusting the creator to run their code in this app without your knowledge. Are you sure you want to continue?"
                extraContent={
                  <Card>
                    <Text variant="text-md/bold">{url}</Text>
                  </Card>
                }
                actions={
                  <AlertActions>
                    <AlertActionButton
                      text="Continue"
                      variant="primary"
                      onPress={() => {
                        VdPluginManager.installPlugin(url)
                          .then(() =>
                            showToast(
                              Strings.TOASTS_INSTALLED_PLUGIN,
                              findAssetId("Check"),
                            ),
                          )
                          .catch((e) =>
                            openAlert(
                              "bunny-plugin-install-failed",
                              <AlertModal
                                title="Install Failed"
                                content={`Unable to install plugin from '${url}':`}
                                extraContent={
                                  <Card>
                                    <Text variant="text-md/normal">
                                      {e instanceof Error
                                        ? e.message
                                        : String(e)}
                                    </Text>
                                  </Card>
                                }
                                actions={
                                  <AlertActionButton
                                    text="Okay"
                                    variant="primary"
                                  />
                                }
                              />,
                            ),
                          );
                      }}
                    />
                    <AlertActionButton text="Cancel" variant="secondary" />
                  </AlertActions>
                }
              />,
            );
          } else {
            return await VdPluginManager.installPlugin(url);
          }
        },
      }}
    />
  );
}
