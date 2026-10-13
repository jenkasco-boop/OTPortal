using OtPortal.Api.Data;

namespace OtPortal.Api.Domain;

public static class SavedPlaces
{
    /// <summary>GPS of the same building drifts by tens of metres between visits.</summary>
    public const double MatchRadiusMeters = 100;

    /// <summary>Same Google place id first; otherwise the nearest place within <see cref="MatchRadiusMeters"/>.</summary>
    public static SavedPlace? Match(IEnumerable<SavedPlace> places, string? placeId, double lat, double lng)
    {
        var list = places as IReadOnlyCollection<SavedPlace> ?? places.ToList();
        if (placeId is not null && list.FirstOrDefault(p => p.PlaceId == placeId) is { } byId) return byId;
        return list
            .Select(p => (Place: p, Distance: DistanceMeters(lat, lng, p.Lat, p.Lng)))
            .Where(x => x.Distance <= MatchRadiusMeters)
            .OrderBy(x => x.Distance)
            .Select(x => x.Place)
            .FirstOrDefault();
    }

    /// <summary>Haversine distance.</summary>
    public static double DistanceMeters(double lat1, double lng1, double lat2, double lng2)
    {
        const double earthRadius = 6_371_000;
        static double Rad(double deg) => deg * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLng = Rad(lng2 - lng1);
        var a = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Pow(Math.Sin(dLng / 2), 2);
        return 2 * earthRadius * Math.Asin(Math.Sqrt(a));
    }
}
