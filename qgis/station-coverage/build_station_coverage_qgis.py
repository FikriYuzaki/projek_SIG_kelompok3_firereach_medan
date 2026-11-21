"""
Generator proyek QGIS (`station_coverage.qgz`), gaya simbologi (.qml), dan Print Layout PNG
untuk modul Fire Station Coverage (`station-coverage`).
"""

from __future__ import annotations

import os
from pathlib import Path
import zipfile

from qgis.core import (
    Qgis,
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFillSymbol,
    QgsLayoutExporter,
    QgsLayoutItemLabel,
    QgsLayoutItemLegend,
    QgsLayoutItemMap,
    QgsLayoutItemMapGrid,
    QgsLayoutItemPolygon,
    QgsLayoutItemScaleBar,
    QgsLayoutItemShape,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLegendStyle,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsPrintLayout,
    QgsProject,
    QgsRendererCategory,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtCore import QPointF, Qt
from qgis.PyQt.QtGui import QColor, QFont, QPolygonF

SCRIPT_DIR = Path(__file__).resolve().parent
QGZ_PATH = SCRIPT_DIR / "station_coverage.qgz"
PNG_PATH = SCRIPT_DIR / "exports" / "peta_jangkauan_pos_damkarmat_medan_mako00.png"
STYLES_DIR = SCRIPT_DIR / "styles"


def _make_font(family: str, size_pt: float, bold: bool = False) -> QFont:
    font = QFont(family, int(round(size_pt)))
    font.setPointSizeF(size_pt)
    font.setBold(bold)
    return font


def _style_district_boundary(layer: QgsVectorLayer) -> None:
    sym = QgsFillSymbol.createSimple(
        {"color": "244,242,236,80", "outline_color": "#556164", "outline_width": "0.3", "outline_style": "solid"}
    )
    layer.renderer().setSymbol(sym)


def _style_main_roads(layer: QgsVectorLayer) -> None:
    sym = QgsLineSymbol.createSimple({"line_color": "110,122,125,135", "line_width": "0.22"})
    layer.renderer().setSymbol(sym)


def _style_euclidean_buffers(layer: QgsVectorLayer) -> None:
    categories = []
    specs = [
        (5000, "Buffer Lurus 5 km", "184,74,53,220", "0.45", "dash"),
        (3000, "Buffer Lurus 3 km", "213,138,67,220", "0.45", "dash"),
        (2000, "Buffer Lurus 2 km", "32,42,45,220", "0.45", "dash"),
    ]
    for val, lbl, stroke, width, style in specs:
        sym = QgsFillSymbol.createSimple(
            {"color": "0,0,0,0", "outline_color": stroke, "outline_width": width, "outline_style": style}
        )
        categories.append(QgsRendererCategory(val, sym, lbl))
    layer.setRenderer(QgsCategorizedSymbolRenderer("threshold_m", categories))


def _style_network_areas(layer: QgsVectorLayer) -> None:
    categories = []
    specs = [
        (2000, "Jaringan Jalan <= 2 km (~3.4 mnt @ 35 km/j)", "53,96,103,185", "#244449"),
        (3000, "Jaringan Jalan <= 3 km (~5.1 mnt @ 35 km/j)", "71,122,130,135", "#356067"),
        (5000, "Jaringan Jalan <= 5 km (~8.6 mnt @ 35 km/j)", "213,138,67,105", "#8A5218"),
    ]
    for val, lbl, fill_rgba, stroke_hex in specs:
        sym = QgsFillSymbol.createSimple(
            {"color": fill_rgba, "outline_color": stroke_hex, "outline_width": "0.35", "outline_style": "solid"}
        )
        categories.append(QgsRendererCategory(val, sym, lbl))
    layer.setRenderer(QgsCategorizedSymbolRenderer("threshold_m", categories))


def _style_mako(layer: QgsVectorLayer) -> None:
    sym = QgsMarkerSymbol.createSimple(
        {"name": "square", "color": "#B84A35", "outline_color": "#FFFFFF", "outline_width": "0.6", "size": "3.8"}
    )
    layer.renderer().setSymbol(sym)

    lbl_settings = QgsPalLayerSettings()
    lbl_settings.fieldName = "'Mako 0.0 (Jl. Candi Borobudur)'"
    lbl_settings.isExpression = True
    lbl_settings.dist = 2.2
    fmt = QgsTextFormat()
    fmt.setFont(_make_font("Sans Serif", 7.8, bold=True))
    fmt.setSize(7.8)
    fmt.setColor(QColor("#202A2D"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.9)
    buf.setColor(QColor("#FFFFFF"))
    fmt.setBuffer(buf)
    lbl_settings.setFormat(fmt)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(lbl_settings))
    layer.setLabelsEnabled(True)


def _add_rect(layout, x, y, w, h, fill_hex, stroke_hex=None, stroke_w=0.3):
    s = QgsLayoutItemShape(layout)
    s.setShapeType(QgsLayoutItemShape.Rectangle)
    s.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    s.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    props = {"color": fill_hex}
    if stroke_hex:
        props["outline_color"] = stroke_hex
        props["outline_width"] = str(stroke_w)
        props["outline_style"] = "solid"
    else:
        props["outline_style"] = "no"
    s.setSymbol(QgsFillSymbol.createSimple(props))
    layout.addLayoutItem(s)
    return s


def _add_label(layout, text, x, y, w, h, size, color="#202A2D", bold=False, mono=False, halign=Qt.AlignmentFlag.AlignLeft):
    lbl = QgsLayoutItemLabel(layout)
    lbl.setText(text)
    lbl.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    lbl.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    fmt = QgsTextFormat()
    fmt.setFont(_make_font("IBM Plex Mono" if mono else "Sans Serif", size, bold=bold))
    fmt.setSize(size)
    fmt.setColor(QColor(color))
    lbl.setTextFormat(fmt)
    lbl.setHAlign(halign)
    lbl.setMarginX(1.0)
    lbl.setMarginY(0.5)
    layout.addLayoutItem(lbl)
    return lbl


def _add_north_arrow(layout, cx, cy):
    poly = QPolygonF([QPointF(cx, cy - 5.5), QPointF(cx + 3.2, cy + 4.0), QPointF(cx, cy + 1.8), QPointF(cx - 3.2, cy + 4.0), QPointF(cx, cy - 5.5)])
    item = QgsLayoutItemPolygon(poly, layout)
    item.setSymbol(QgsFillSymbol.createSimple({"color": "#202A2D", "outline_color": "#202A2D", "outline_width": "0.2"}))
    layout.addLayoutItem(item)
    _add_label(layout, "U", cx - 3.0, cy + 4.3, 6.0, 4.5, 7.5, bold=True, halign=Qt.AlignmentFlag.AlignHCenter)


def build_project() -> None:
    STYLES_DIR.mkdir(parents=True, exist_ok=True)
    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)

    qgs = QgsApplication([], False)
    qgs.initQgis()
    try:
        os.chdir(SCRIPT_DIR)
        project = QgsProject.instance()
        project.clear()
        project.setFileName(QGZ_PATH.name)
        project.setFilePathStorage(Qgis.FilePathType.Relative)

        utm_crs = QgsCoordinateReferenceSystem("EPSG:32647")
        wgs_crs = QgsCoordinateReferenceSystem("EPSG:4326")
        project.setCrs(utm_crs)
        project.setTitle("FireReach Medan - Station Coverage Analysis (Provisional Mako 0.0)")

        mako_lyr = QgsVectorLayer("./layers/station_coverage_analysis.gpkg|layername=mako_verified", "Mako 0.0 Damkarmat Medan (Terverifikasi)", "ogr")
        net_lyr = QgsVectorLayer("./layers/station_coverage_analysis.gpkg|layername=network_service_areas_utm", "Service Area Jaringan Jalan OSM (2, 3, 5 km)", "ogr")
        euc_lyr = QgsVectorLayer("./layers/station_coverage_analysis.gpkg|layername=euclidean_buffers_utm", "Buffer Jarak Lurus Euclidean (2, 3, 5 km)", "ogr")
        roads_lyr = QgsVectorLayer("./layers/medan_main_roads_utm.gpkg|layername=medan_main_roads_utm", "Jaringan Jalan Utama Medan (OSM)", "ogr")
        dist_lyr = QgsVectorLayer("../../public/data/medan_districts_osm.geojson", "Batas 21 Kecamatan Medan (Fallback OSM)", "ogr")

        for lyr, label in ((mako_lyr, "mako"), (net_lyr, "network"), (euc_lyr, "euclidean"), (roads_lyr, "roads"), (dist_lyr, "districts")):
            if not lyr.isValid():
                raise RuntimeError(f"Layer QGIS gagal dimuat: {label}")

        _style_mako(mako_lyr)
        _style_network_areas(net_lyr)
        _style_euclidean_buffers(euc_lyr)
        _style_main_roads(roads_lyr)
        _style_district_boundary(dist_lyr)

        net_lyr.saveNamedStyle(str(STYLES_DIR / "network_service_area.qml"))
        euc_lyr.saveNamedStyle(str(STYLES_DIR / "euclidean_buffers.qml"))
        mako_lyr.saveNamedStyle(str(STYLES_DIR / "mako_station.qml"))

        for lyr in (mako_lyr, euc_lyr, net_lyr, roads_lyr, dist_lyr):
            project.addMapLayer(lyr, False)

        root = project.layerTreeRoot()
        for lyr in (mako_lyr, euc_lyr, net_lyr, roads_lyr, dist_lyr):
            root.addLayer(lyr)

        layout = QgsPrintLayout(project)
        layout.initializeDefaults()
        layout.setName("Layout Jangkauan Pos Damkarmat Mako 0.0")
        layout.pageCollection().page(0).setPageSize("A4", layout.pageCollection().page(0).Orientation.Landscape)

        _add_rect(layout, 0.0, 0.0, 297.0, 210.0, "#F4F2EC")
        _add_rect(layout, 10.0, 8.0, 277.0, 20.5, "#FFFFFF", "#D9DEDA", 0.3)
        _add_rect(layout, 10.0, 8.0, 2.0, 20.5, "#356067")
        _add_label(layout, "Peta Jangkauan Layanan Mako 0.0 Damkarmat Kota Medan (PROVISIONAL)", 15.0, 10.0, 266.0, 9.0, 13.5, bold=True)
        _add_label(layout, "Perbandingan Service Area Jaringan Jalan OSM (2, 3, 5 km) vs Buffer Euclidean | Asumsi Skenario 35 km/jam (Bukan Waktu Respons Aktual)", 15.0, 18.8, 266.0, 7.0, 8.5, color="#556164")

        ct = QgsCoordinateTransform(wgs_crs, utm_crs, project)
        utm_extent = ct.transformBoundingBox(dist_lyr.extent())
        utm_extent.scale(1.12)

        map_item = QgsLayoutItemMap(layout)
        map_item.attemptMove(QgsLayoutPoint(10.0, 31.0, QgsUnitTypes.LayoutMillimeters))
        map_item.attemptResize(QgsLayoutSize(183.0, 160.0, QgsUnitTypes.LayoutMillimeters))
        map_item.setCrs(utm_crs)
        map_item.setLayers([mako_lyr, euc_lyr, net_lyr, roads_lyr, dist_lyr])
        map_item.zoomToExtent(utm_extent)
        map_item.setBackgroundEnabled(True)
        map_item.setBackgroundColor(QColor("#FFFFFF"))
        map_item.setFrameEnabled(True)
        map_item.setFrameStrokeColor(QColor("#202A2D"))

        grid = QgsLayoutItemMapGrid("UTM 47N Grid", map_item)
        grid.setEnabled(True)
        grid.setCrs(utm_crs)
        grid.setIntervalX(5000.0)
        grid.setIntervalY(5000.0)
        grid.setAnnotationEnabled(True)
        grid.setAnnotationPrecision(0)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Left)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Bottom)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Right)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Top)
        grid.setAnnotationDirection(QgsLayoutItemMapGrid.Vertical, QgsLayoutItemMapGrid.Left)
        g_fmt = QgsTextFormat()
        g_fmt.setFont(_make_font("IBM Plex Mono", 6.5))
        g_fmt.setSize(6.5)
        g_fmt.setColor(QColor("#556164"))
        grid.setAnnotationTextFormat(g_fmt)
        grid.setLineSymbol(QgsLineSymbol.createSimple({"line_color": "217,222,218,175", "line_width": "0.18"}))
        map_item.grids().addGrid(grid)
        layout.addLayoutItem(map_item)

        _add_rect(layout, 197.0, 31.0, 90.0, 160.0, "#FFFFFF", "#D9DEDA", 0.3)

        legend = QgsLayoutItemLegend(layout)
        legend.setTitle("Legenda Jangkauan")
        legend.setLinkedMap(map_item)
        legend.setAutoUpdateModel(False)
        legend.setStyleFont(QgsLegendStyle.Title, _make_font("Sans Serif", 9.0, bold=True))
        legend.setStyleFont(QgsLegendStyle.Subgroup, _make_font("Sans Serif", 7.5, bold=True))
        legend.setStyleFont(QgsLegendStyle.SymbolLabel, _make_font("Sans Serif", 6.8))
        legend.setSymbolWidth(5.0)
        legend.setSymbolHeight(3.0)
        legend.attemptMove(QgsLayoutPoint(200.0, 33.0, QgsUnitTypes.LayoutMillimeters))
        legend.attemptResize(QgsLayoutSize(84.0, 74.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(legend)

        scale_bar = QgsLayoutItemScaleBar(layout)
        scale_bar.setLinkedMap(map_item)
        scale_bar.setStyle("Single Box")
        scale_bar.setUnits(QgsUnitTypes.DistanceKilometers)
        scale_bar.setUnitLabel("km")
        scale_bar.setNumberOfSegments(2)
        scale_bar.setNumberOfSegmentsLeft(0)
        scale_bar.setUnitsPerSegment(2.5)
        scale_bar.setHeight(2.5)
        scale_bar.setFont(_make_font("IBM Plex Mono", 7.0))
        scale_bar.attemptMove(QgsLayoutPoint(200.0, 110.0, QgsUnitTypes.LayoutMillimeters))
        scale_bar.attemptResize(QgsLayoutSize(62.0, 11.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(scale_bar)
        _add_north_arrow(layout, 276.0, 115.0)

        _add_rect(layout, 200.0, 125.0, 84.0, 63.0, "#FBF2E6", "#D58A43", 0.3)
        _add_rect(layout, 200.0, 125.0, 1.5, 63.0, "#8A5218")
        _add_label(
            layout,
            "CATATAN METODE & KETERBATASAN DATA\n"
            "1. Baru mencakup 1 pos terverifikasi (Mako 0.0). Lokasi pos UPT dari p2k.medan.go.id belum dapat diakses (HTTP 403) sehingga cakupan bersifat PROVISIONAL.\n"
            "2. Jaringan jalan dari Geofabrik Sumatra OSM PBF (2026-11-21) disaring untuk kelas jalan kendaraan & oneway.\n"
            "3. Estimasi menit memakai kecepatan skenario 35 km/jam, bukan waktu respons operasional aktual Damkarmat.\n"
            "4. CRS analisis: EPSG:32647 | Batas: OpenStreetMap Nominatim (ODbL, © OpenStreetMap contributors).",
            203.0,
            127.0,
            79.0,
            59.0,
            6.5,
        )

        _add_label(
            layout,
            "FireReach Medan | Modul: station-coverage (Adriel) | Proyek: station_coverage.qgz | CRS Peta: EPSG:32647 (UTM 47N)",
            10.0,
            200.5,
            277.0,
            6.5,
            7.5,
            color="#556164",
            mono=True,
        )

        project.layoutManager().addLayout(layout)
        if not project.write(str(QGZ_PATH)):
            raise RuntimeError("Gagal menulis station_coverage.qgz")

        with zipfile.ZipFile(QGZ_PATH, "r") as zf:
            qgs_name = next(n for n in zf.namelist() if n.endswith(".qgs"))
            xml_text = zf.read(qgs_name).decode("utf-8", errors="replace")
            if "C:\\" in xml_text or "C:/" in xml_text or "firereach-medan" in xml_text:
                raise RuntimeError("station_coverage.qgz masih mengandung path absolut!")

        exporter = QgsLayoutExporter(layout)
        settings = QgsLayoutExporter.ImageExportSettings()
        settings.dpi = 150
        res = exporter.exportToImage(str(PNG_PATH), settings)
        if res != QgsLayoutExporter.Success:
            raise RuntimeError(f"Gagal ekspor PNG station_coverage: {res}")

        print(f"Berhasil membuat {QGZ_PATH} dan {PNG_PATH}")
    finally:
        QgsProject.instance().clear()
        qgs.exitQgis()


if __name__ == "__main__":
    build_project()
