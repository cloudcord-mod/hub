import { formatString, Strings } from "@core/i18n";
import AddonPage from "@core/ui/components/AddonPage";
import { type CxAddonRow, disableCxAddon, useCxAddonRows } from "@core/ui/settings/pages/CxExtensions";
import { AddonActions, CxAddonCard } from "@core/ui/settings/pages/CxExtensions/AddonCard";
import ThemeCard from "@core/ui/settings/pages/Themes/ThemeCard";
import { useProxy } from "@core/vendetta/storage";
import {
  getCurrentTheme,
  installTheme,
  themes,
  VdThemeInfo,
} from "@lib/addons/themes";
import { colorsPref } from "@lib/addons/themes/colors/preferences";
import { updateBunnyColor } from "@lib/addons/themes/colors/updater";
import { Author } from "@lib/addons/types";
import { findAssetId } from "@lib/api/assets";
import { settings } from "@lib/api/settings";
import { useObservable } from "@lib/api/storage";
import {
  ActionSheet,
  BottomSheetTitleHeader,
  Button,
  TableRowGroup,
  TableCheckboxRow,
  TableRowIcon,
  TableSwitchRow,
} from "@metro/common/components";
import { View } from "react-native";

/**
 * Theme options have been changed from radio groups to individual switches
 * for better UX. Each option can now be toggled independently.
 */

export default function Themes() {
  useProxy(settings);
  useProxy(themes);
  const cxThemes = useCxAddonRows("theme");
  const activeCxTheme = cxThemes.find(theme => theme.active);
  const themeName = (theme: VdThemeInfo | CxAddonRow) => "source" in theme ? theme.name : theme.data.name;

  return (
    <AddonPage<VdThemeInfo | CxAddonRow>
      title={Strings.THEMES}
      isEnabled={theme => "source" in theme ? theme.active : !activeCxTheme && theme.selected}
      searchKeywords={[
        themeName,
        (p) => ("source" in p ? p.description : p.data.description) ?? "",
        (p) => "source" in p ? p.keywords ?? "" : p.data.authors?.map((a: Author) => a.name).join(", ") ?? "",
      ]}
      sortOptions={{
        "Name (A-Z)": (a, b) => themeName(a).localeCompare(themeName(b)),
        "Name (Z-A)": (a, b) => themeName(b).localeCompare(themeName(a)),
      }}
      installAction={{
        label: "Install a theme",
        fetchFn: installTheme,
      }}
      items={[...Object.values(themes), ...cxThemes]}
      ListHeaderComponent={() => <AddonActions kind="theme" />}
      safeModeHint={{
        message: formatString("SAFE_MODE_NOTICE_THEMES", {
          enabled: Boolean(settings.safeMode?.currentThemeId),
        }),
        footer: settings.safeMode?.currentThemeId && (
          <Button
            size="small"
            text={Strings.DISABLE_THEME}
            onPress={() => delete settings.safeMode?.currentThemeId}
            style={{ marginTop: 8 }}
          />
        ),
      }}
      CardComponent={({ item, result }) => "source" in item
        ? <CxAddonCard kind="theme" entry={item} />
        : <ThemeCard item={item} result={result as Fuzzysort.KeysResult<VdThemeInfo>} overridden={!!activeCxTheme}
            beforeSelect={() => { if (activeCxTheme) disableCxAddon(activeCxTheme.id, activeCxTheme.name); }} />}
      OptionsActionSheetComponent={() => {
        useObservable([colorsPref]);

        return (
          <ActionSheet>
            <BottomSheetTitleHeader title="Options" />
            <View style={{ paddingVertical: 20, gap: 12 }}>
              {/* Changed from TableRadioGroup to individual TableSwitchRow components
                  for better UX - users can now toggle options individually */}
              <TableRowGroup title="Override Theme Type">
                <TableSwitchRow
                  label="Auto"
                  icon={<TableRowIcon source={findAssetId("RobotIcon")} />}
                  value={!colorsPref.type}
                  onValueChange={(enabled: boolean) => {
                    if (enabled) {
                      colorsPref.type = undefined;
                    } else {
                      colorsPref.type = "dark";
                    }
                    getCurrentTheme()?.data &&
                      updateBunnyColor(getCurrentTheme()!.data!, {
                        update: true,
                      });
                  }}
                />
                <TableSwitchRow
                  label="Dark"
                  icon={<TableRowIcon source={findAssetId("ThemeDarkIcon")} />}
                  value={colorsPref.type === "dark"}
                  onValueChange={(enabled: boolean) => {
                    colorsPref.type = enabled ? "dark" : undefined;
                    getCurrentTheme()?.data &&
                      updateBunnyColor(getCurrentTheme()!.data!, {
                        update: true,
                      });
                  }}
                />
                <TableSwitchRow
                  label="Light"
                  icon={<TableRowIcon source={findAssetId("ThemeLightIcon")} />}
                  value={colorsPref.type === "light"}
                  onValueChange={(enabled: boolean) => {
                    colorsPref.type = enabled ? "light" : undefined;
                    getCurrentTheme()?.data &&
                      updateBunnyColor(getCurrentTheme()!.data!, {
                        update: true,
                      });
                  }}
                />
              </TableRowGroup>
              <TableRowGroup title="Chat Background">
                <TableSwitchRow
                  label="Show Background"
                  icon={<TableRowIcon source={findAssetId("ImageIcon")} />}
                  value={!colorsPref.customBackground}
                  onValueChange={(enabled: boolean) => {
                    colorsPref.customBackground = enabled ? null : "hidden";
                  }}
                />
                <TableSwitchRow
                  label="Hide Background"
                  icon={<TableRowIcon source={findAssetId("DenyIcon")} />}
                  value={colorsPref.customBackground === "hidden"}
                  onValueChange={(enabled: boolean) => {
                    colorsPref.customBackground = enabled ? "hidden" : null;
                  }}
                />
              </TableRowGroup>
            </View>
          </ActionSheet>
        );
      }}
    />
  );
}
