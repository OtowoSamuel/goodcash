using UnityEngine;

// Opens the GoodCash flow and listens for mygame://cashout?goodcash_cashout=<id>&status=<status>
public class GoodCashCashOut : MonoBehaviour
{
    const string PublishableKey = "gc_pk_test_REPLACE_ME";
    const string ReturnUrl = "mygame://cashout";

    public void Open(string playerId, decimal amountG)
    {
        var url = "https://pay.goodcash.xyz/?key=" + PublishableKey
                + "&mode=redirect&amountG=" + amountG.ToString(System.Globalization.CultureInfo.InvariantCulture)
                + "&ref=" + UnityEngine.Networking.UnityWebRequest.EscapeURL(playerId)
                + "&returnUrl=" + UnityEngine.Networking.UnityWebRequest.EscapeURL(ReturnUrl)
                + "&app=com.example.mygame";
        // Use your WebView plugin here; Application.OpenURL opens the system browser instead.
        Application.OpenURL(url);
    }

    void Awake() { Application.deepLinkActivated += OnDeepLink; }

    void OnDeepLink(string link)
    {
        if (!link.StartsWith(ReturnUrl)) return;
        // Show "On its way to your bank". Credit or notify the player from your server webhook (cashout.paid).
        Debug.Log("GoodCash returned: " + link);
    }
}
